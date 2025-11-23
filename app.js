'use strict';

/*
  FINAL CLEAN VERSION
  - Green Debugger REMOVED.
  - Incoming Call Popup FIXED.
  - Video Z-Index FIXED (Video stays on top).
  - Ringtones & Connections stabilized.
*/

const supabase = window.supabase;
if (!supabase) throw new Error('Supabase missing');

// STUN Servers (Google)
// NOTE: If calling fails on 4G/5G, you need a paid TURN server. This works on WiFi.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

// Global State
let currentUser = null;
let myProfile = null;
let activeContact = null;
let myContacts = [];
let audioCtx = null;
let globalSub = null;
let messageSub = null;


// WebRTC Globals
let pc = null;
let localStream = null;
let remoteStream = null;
let callsChannel = null;
let currentCallId = null;
let currentRemoteUser = null; 
let iceCandidatesQueue = []; 
let scannerStream = null;

// Sound
const BEEP_SOUND = new Audio("data:audio/mp3;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgRYWFgAAAAwAAADbWlub3JfdmVyc2lvbgAwAFRYWFgAAAAkAAADY29tcGF0aWJsZV9icmFuZHMAbXA0Mmlzb21tcDQx//uQZAAAAAAA0AAAAABAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcYAAAAAAABAAAIMwAAAAAS");

/* -------------------- HELPERS -------------------- */
function get(id) { return document.getElementById(id); }
function getVal(id) { return get(id) ? get(id).value.trim() : ''; }
function setText(id, val) { if (get(id)) get(id).textContent = val; }
function setBtn(id, txt, disabled) { const b = get(id); if (b) { b.textContent = txt; b.disabled = disabled; } }
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }
function escapeHtml(s) { return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function convIdFor(a,b) { return [a,b].sort().join('_'); }
const on = (id, evt, fn) => { const el = get(id); if (el) el.addEventListener(evt, fn); };

/* -------------------- INIT -------------------- */
document.addEventListener('DOMContentLoaded', () => {
  navigator.serviceWorker.register('/sw.js');
   if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service worker registered:', reg))
      .catch(err => console.error('SW registration failed:', err));
  }
  document.body.addEventListener('click', () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });


  // Bindings
  on('btnSignUp', 'click', handleSignUp);
  on('btnSignIn', 'click', handleSignIn);
  on('btnDemo', 'click', handleDemo);
  on('tabSignIn', 'click', () => switchTab('signin'));
  on('tabSignUp', 'click', () => switchTab('signup'));
  on('btnSaveProfile', 'click', saveProfile);
  on('btnSkipProfile', 'click', skipProfile);
  on('profileAvatar', 'change', handleAvatarSelect);
  on('btnOpenProfile', 'click', openProfileScreen);
  on('btnAddContactMain', 'click', () => show(get('modalAddContact')));
  on('addContactCancel', 'click', () => hide(get('modalAddContact')));
  on('addContactSave', 'click', saveNewContact);
  on('btnFindByPhone', 'click', saveNewContact);
  on('contactSearch', 'input', (e) => renderContacts(e.target.value));
  on('btnRefresh', 'click', loadContacts);
  on('btnSendMain', 'click', (e) => { e.preventDefault(); sendMessage(); });
  on('inputMessage', 'keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  on('btnAttachMain', 'click', () => get('attachFile').click());
  on('attachFile', 'change', (e) => renderFilePreview(e.target.files));
  on('btnClearChat', 'click', clearChat);
  on('btnBackMobile', 'click', () => {
  // Example action: close chat panel and go back to contacts
  const chatPanel = get('chatPanel');
  if (chatPanel) {
    chatPanel.classList.remove('active-screen');
  }
  // Optionally hide chat and show contacts list
  show(get('contactsSection'));
  hide(get('chatSection'));
});
   on('btnVoiceCall', 'click', () => startCallAction(false));
  on('btnVideoCall', 'click', () => startCallAction(true));
  on('btnEmoji', 'click', showEmojiPicker);
  
  // CALL BUTTONS
  on('btnVoiceCall', 'click', () => startCallAction(false));
  on('btnVideoCall', 'click', () => startCallAction(true));

  on('btnShowQr', 'click', showMyQr);
  on('qrClose', 'click', () => hide(get('modalQr')));
  on('btnScanQr', 'click', startQrScan);
  on('qrScanClose', 'click', () => { stopScanner(); hide(get('modalQrScan')); });

  checkSession();
});

/* -------------------- AUTH & DATA -------------------- */
async function checkSession() {
  const { data } = await supabase.auth.getSession();
  currentUser = data?.session?.user || null;
  if (!currentUser) showScreen('auth'); else await loadUserProfile();
}

function switchTab(t) {
  if (t === 'signin') { hide(get('formSignUp')); show(get('formSignIn')); get('tabSignIn').classList.add('active'); get('tabSignUp').classList.remove('active'); }
  else { hide(get('formSignIn')); show(get('formSignUp')); get('tabSignUp').classList.add('active'); get('tabSignIn').classList.remove('active'); }
}
function showScreen(s) { ['authSection','profileSection','appSection'].forEach(id => hide(get(id))); show(get(s + 'Section')); }

async function handleSignIn() {
  const email = getVal('signinEmail'); const pass = getVal('signinPass');
  if (!email || !pass) return alert('Required');
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) alert(error.message); else checkSession();
}

async function handleSignUp() {
  const email = getVal('signupEmail'); const pass = getVal('signupPass');
  if (!email || pass.length < 6) return alert('Invalid');
  const { error } = await supabase.auth.signUp({ email, password: pass });
  if (error) alert(error.message); else { await supabase.auth.signInWithPassword({ email, password: pass }); checkSession(); }
}

async function handleDemo() {
  const email = `demo${Date.now()}@test.com`; const pass = 'password123';
  await supabase.auth.signUp({ email, password: pass });
  await supabase.auth.signInWithPassword({ email, password: pass });
  checkSession();
}

async function loadUserProfile() {
  const { data } = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if (data) {
    myProfile = data;
    showScreen('app');
    setText('meName', data.username || 'Me');
    setText('mePhone', data.phone || '');
    get('profileName').value = data.username || '';
    get('profilePhone').value = data.phone || '';
    if (data.avatar_path) {
       const url = await getSignedUrl('avatars', data.avatar_path);
       if(url) get('meAvatar').innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    }
    loadContacts(); subscribeToGlobalEvents(); registerPush(); startPresence(); handleUrlParams();
  } else {
    get('profileName').value = currentUser.email.split('@')[0];
    showScreen('profile');
  }
}

async function saveProfile() {
  const name = getVal('profileName'); const phone = getVal('profilePhone');
  if (!phone) return alert('Phone required');
  setBtn('btnSaveProfile','Saving...',true);
  let avatar_path = myProfile?.avatar_path || null;
  if (get('profileAvatar') && get('profileAvatar').files[0]) {
    avatar_path = `avatars/${currentUser.id}/${Date.now()}.png`;
    await supabase.storage.from('avatars').upload(avatar_path, get('profileAvatar').files[0]);
  }
  const updateData = { id: currentUser.id, username: name, phone, avatar_path, last_seen: new Date() };
  const { error } = await supabase.from('profiles').upsert(updateData);
  if (error) alert(error.message); else { myProfile = updateData; await loadUserProfile(); }
  setBtn('btnSaveProfile','Next',false);
}

async function skipProfile() {
  await supabase.from('profiles').upsert({ id: currentUser.id, username: 'User', phone: '', last_seen: new Date() });
  await loadUserProfile();
}

async function loadContacts() {
  if (!get('contactsList')) return;
  const { data } = await supabase.from('contacts').select('*').eq('owner', currentUser.id);
  myContacts = data || []; renderContacts();
}

function renderContacts(filter = '') {
  const list = get('contactsList'); if (!list) return;
  list.innerHTML = '';
  const filtered = myContacts.filter(c => (c.name || '').toLowerCase().includes(filter.toLowerCase()) || (c.phone||'').includes(filter));
  if (filtered.length === 0) { list.innerHTML = '<div style="padding:20px;text-align:center;color:#888">No contacts.</div>'; return; }
  filtered.forEach(c => {
    const div = document.createElement('div'); div.className = 'contact';
    div.innerHTML = `<div class="avatar">${(c.name||'U')[0].toUpperCase()}</div><div><div style="font-weight:bold;color:#e9edef;">${escapeHtml(c.name||c.phone)}</div><div style="font-size:12px;color:#8696a0;">${escapeHtml(c.phone||'')}</div></div>`;
    div.onclick = () => openChat(c);
    list.appendChild(div);
  });
}

async function saveNewContact() {
  const phone = getVal('addContactPhone'); const name = getVal('addContactName');
  if (!phone) return alert('Phone required');
  const { data: user } = await supabase.from('profiles').select('*').eq('phone', phone).maybeSingle();
  const newContact = { owner: currentUser.id, phone, name: name || (user ? user.username : phone), contact_user: user ? user.id : null };
  await supabase.from('contacts').insert([newContact]);
  hide(get('modalAddContact')); loadContacts();
}

async function openChat(contact) {
  if (!contact.contact_user) return alert('User not registered');
  activeContact = contact;
  setText('chatTitle', contact.name); setText('chatSubtitle', contact.phone); setText('chatAvatar', (contact.name||'U')[0].toUpperCase());
  if (window.innerWidth < 900) get('chatPanel').classList.add('active-screen');
  loadMessages();
}

async function loadMessages() {
  const container = get('messages');
  const convId = convIdFor(currentUser.id, activeContact.contact_user);
  await supabase.from('conversations').upsert({ id: convId });
  const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at');
  container.innerHTML = '';
  if (data && data.length > 0) for (const m of data) await renderMessage(m);
  else container.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">No messages</div>';
  
  if (messageSub) messageSub.unsubscribe();
  messageSub = supabase.channel('chat:' + convId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, payload => {
      if (!document.getElementById(`msg-${payload.new.id}`)) { renderMessage(payload.new); if(payload.new.from_user!==currentUser.id) playTone('receive'); }
    }).subscribe();
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}

async function sendMessage() {
  if (!activeContact) return alert('Open chat first');
  const text = getVal('inputMessage'); const files = get('attachFile').files;
  if (!text && files.length === 0) return;
  playTone('send'); get('inputMessage').value = '';
  const convId = convIdFor(currentUser.id, activeContact.contact_user);
  let attachments = [];
  if (files.length > 0) {
    for (const f of files) {
      const path = `attachments/${convId}/${Date.now()}_${f.name}`;
      await supabase.storage.from('attachments').upload(path, f);
      attachments.push({ path, type: f.type, name: f.name });
    }
    get('attachFile').value = ''; get('filePreview').innerHTML = '';
  }
  const payload = { conversation_id: convId, from_user: currentUser.id, text, attachments: attachments.length ? JSON.stringify(attachments) : null };
  await supabase.from('messages').insert([payload]);
  try { sendPush(activeContact.contact_user, 'New Message', text || 'File'); } catch(e) {}
}

function renderMessage(msg) {
  const container = get('messages');
  if (container.innerHTML.includes('No messages')) container.innerHTML = '';
  const div = document.createElement('div'); div.id = `msg-${msg.id}`; div.className = `msg ${msg.from_user === currentUser.id ? 'me' : 'them'}`;
  let content = `<div>${escapeHtml(msg.text)}</div>`;
  div.innerHTML = content + `<div class="time">${new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>`;
  container.appendChild(div); container.scrollTop = container.scrollHeight;
  if (msg.attachments) {
    try { JSON.parse(msg.attachments).forEach(async (a) => {
        const url = await getSignedUrl('attachments', a.path);
        if (url) div.innerHTML += a.type.startsWith('image') ? `<img src="${url}" style="max-width:200px;border-radius:8px;margin-top:5px;">` : `<div class="doc-thumb"><a href="${url}" target="_blank">📄 ${a.name}</a></div>`;
      }); } catch(e){}
  }
}

/* -------------------- CALLING LOGIC -------------------- */

/* -------------------- CALLING LOGIC -------------------- */

async function startCallAction(video) {
  if (!activeContact || !activeContact.contact_user) return alert('Select a contact');
  
  currentCallId = `call_${Date.now()}`;
  currentRemoteUser = activeContact.contact_user; 
  iceCandidatesQueue = [];

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  setupPCListeners();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: !!video, audio: true });
    const localEl = get('localVideo');
    if (localEl) {
      localEl.srcObject = localStream;
      localEl.muted = true;
      localEl.autoplay = true;
      localEl.playsInline = true;
    }
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  } catch (err) {
    return alert("Camera/Mic blocked! Check browser permissions.");
  }

  enhancedListenToCallEvents(currentCallId);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await supabase.from('calls').insert([{
      call_id: currentCallId,
      from_user: currentUser.id,
      to_user: currentRemoteUser,
      type: 'offer',
      payload: JSON.stringify(offer)
    }]);
    showOutgoingCallingUI(currentCallId, currentRemoteUser);
  } catch (err) {
    console.warn("OFFER ERROR:", err);
    cleanupCallResources();
  }
}

function setupPCListeners() {
  pc.ontrack = (e) => {
    const remoteEl = get('remoteVideo') || createRemoteVideoElement();
    if (e.streams && e.streams[0]) {
      remoteEl.srcObject = e.streams[0];
    } else {
      if (!remoteStream) remoteStream = new MediaStream();
      remoteStream.addTrack(e.track);
      remoteEl.srcObject = remoteStream;
    }
    remoteEl.onloadedmetadata = () => remoteEl.play().catch(()=>{});
  };

  pc.onicecandidate = async (e) => {
    if (!e.candidate || !currentRemoteUser) return;
    const candidateJSON = e.candidate.toJSON();
    await supabase.from('calls').insert([{
      call_id: currentCallId,
      from_user: currentUser.id,
      to_user: currentRemoteUser,
      type: 'ice',
      payload: JSON.stringify(candidateJSON)
    }]);
  };
}

function enhancedListenToCallEvents(callId) {
  if (callsChannel) { try { callsChannel.unsubscribe(); } catch(e) {} }
  
  callsChannel = supabase.channel('call_' + callId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `call_id=eq.${callId}` }, async ({ new: row }) => {
      if (!row || row.from_user === currentUser.id) return;
      let payload = row.payload;
      if (typeof payload === 'string') try { payload = JSON.parse(payload); } catch(e) {}

      if (row.type === 'answer' && pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        processIceQueue();
      } else if (row.type === 'ice' && pc) {
        const ice = new RTCIceCandidate(payload);
        if (pc.remoteDescription) {
          await pc.addIceCandidate(ice);
        } else {
          iceCandidatesQueue.push(ice);
        }
      } else if (row.type === 'cancel' || row.type === 'reject') {
        cleanupCallResources();
      }
    }).subscribe();
}

function subscribeToGlobalEvents() {
  if (globalSub) { try { globalSub.unsubscribe(); } catch(e) {} }
  globalSub = supabase.channel('user_global_' + currentUser.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `to_user=eq.${currentUser.id}` }, async ({ new: row }) => {
      if (row && row.type === 'offer') {
        currentRemoteUser = row.from_user; 
        showIncomingCallPopup(row);
        if (navigator.vibrate) navigator.vibrate([200,100,200]);
        ensureRingtone(); try { ringtone.play(); } catch(e){}
      }
    }).subscribe();
}

async function handleIncomingCall(row) {
  currentCallId = row.call_id;
  currentRemoteUser = row.from_user; 
  enhancedListenToCallEvents(currentCallId);

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  setupPCListeners();

  let offerPayload = row.payload;
  if (typeof offerPayload === 'string') try { offerPayload = JSON.parse(offerPayload); } catch(e) {}

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const localEl = get('localVideo');
    if (localEl) {
      localEl.srcObject = localStream;
      localEl.muted = true;
      localEl.autoplay = true;
      localEl.playsInline = true;
    }
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  } catch (err) {
    return alert("Camera/Mic blocked!");
  }

  createRemoteVideoElement();

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offerPayload));
    processIceQueue();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await supabase.from('calls').insert([{
      call_id: currentCallId,
      from_user: currentUser.id,
      to_user: currentRemoteUser,
      type: 'answer',
      payload: JSON.stringify(answer)
    }]);
  } catch (err) {
    console.warn("ANSWER ERROR:", err);
  }
}

async function processIceQueue() {
  if (!pc) return;
  for (const c of iceCandidatesQueue) await pc.addIceCandidate(c);
  iceCandidatesQueue = [];
}


/* -------------------- UI ELEMENTS -------------------- */
function createRemoteVideoElement() {
  let v = get('remoteVideo');
  if (v) return v;
  v = document.createElement('video');
  v.id = 'remoteVideo';
  v.autoplay = true;
  v.playsInline = true; 
  // Force Z-Index High
  v.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#000;object-fit:cover;";
  document.body.appendChild(v);
  
  let btn = document.createElement('button');
  btn.id = 'endCallBtn';
  btn.innerText = "END CALL";
  btn.style.cssText = "position:fixed;bottom:50px;left:50%;transform:translateX(-50%);z-index:10000;padding:20px 40px;background:red;color:white;border:none;border-radius:30px;font-weight:bold;font-size:16px;box-shadow:0 4px 10px rgba(0,0,0,0.5);";
  btn.onclick = endCall;
  document.body.appendChild(btn);
  
  return v;
}

function cleanupCallResources() {
  if (pc) pc.close(); pc = null;
  if (localStream) localStream.getTracks().forEach(t => t.stop()); localStream = null;
  if (remoteStream) remoteStream.getTracks().forEach(t => t.stop()); remoteStream = null;
  if (callsChannel) callsChannel.unsubscribe();
  currentCallId = null; iceCandidatesQueue = [];
  
  const v = get('remoteVideo'); if (v) v.remove();
  const b = get('endCallBtn'); if (b) b.remove();
  const o = get('outgoingCallUI'); if (o) o.remove();
  const i = get('incomingCallModal'); if (i) i.remove();
  stopRinging();
}

function endCall() {
  if(currentCallId && currentRemoteUser) {
      supabase.from('calls').insert([{call_id:currentCallId, from_user:currentUser.id, to_user:currentRemoteUser, type:'cancel', payload:'{}'}]);
  }
  cleanupCallResources();
}

/* -------------------- MISC UTILS -------------------- */
let ringtone = null;
function ensureRingtone() {
  if (ringtone) return; ringtone = document.createElement('audio');
  ringtone.src = 'https://actions.google.com/sounds/v1/alarms/phone_ringing.ogg';
  ringtone.loop = true;
}
function stopRinging() { if (ringtone) { ringtone.pause(); ringtone.currentTime = 0; } }

function showIncomingCallPopup(row) {
  if (get('incomingCallModal')) return;
  ensureRingtone(); try { ringtone.play(); } catch(e){}
  
  const modal = document.createElement('div'); 
  modal.id = 'incomingCallModal';
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:2147483647;color:white;flex-direction:column;";
  
  modal.innerHTML = `
    <h2 style="margin-bottom:10px;">Incoming Call</h2>
    <div style="margin-bottom:30px;font-size:14px;color:#ccc;">From user...</div>
    <div style="display:flex;gap:20px;">
       <button id="btnAccept" style="padding:15px 40px;background:#00a884;border:none;border-radius:50px;color:white;font-weight:bold;font-size:18px;cursor:pointer;">Accept</button>
       <button id="btnDecline" style="padding:15px 40px;background:#ea0038;border:none;border-radius:50px;color:white;font-weight:bold;font-size:18px;cursor:pointer;">Decline</button>
    </div>`;
    
  document.body.appendChild(modal);
  
  get('btnAccept').onclick = () => { stopRinging(); modal.remove(); handleIncomingCall(row); };
  get('btnDecline').onclick = () => { stopRinging(); modal.remove(); };
}

function showOutgoingCallingUI(id, to) {
  if (get('outgoingCallUI')) return;
  ensureRingtone(); try { ringtone.play(); } catch(e){}
  const d = document.createElement('div'); d.id = 'outgoingCallUI';
  d.innerHTML = `<div style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#222;color:white;padding:15px 25px;border-radius:30px;z-index:20000;display:flex;gap:15px;align-items:center;box-shadow:0 5px 15px rgba(0,0,0,0.5);">
    <span style="font-weight:bold;">Calling...</span> 
    <button id="btnCancelCall" style="background:#ea0038;color:white;border:none;padding:8px 15px;border-radius:15px;font-weight:bold;cursor:pointer;">End</button>
  </div>`;
  document.body.appendChild(d);
  get('btnCancelCall').onclick = endCall;
}
async function getSignedUrl(b, p) { const { data } = await supabase.storage.from(b).createSignedUrl(p, 3600); return data?.signedUrl; }
function playTone(t) { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); if (audioCtx) { const o=audioCtx.createOscillator(); const g=audioCtx.createGain(); o.connect(g); g.connect(audioCtx.destination); o.frequency.value=t==='send'?800:600; g.gain.value=0.1; o.start(); setTimeout(()=>o.stop(),150); } else BEEP_SOUND.play().catch(()=>{}); }
function showToast(m) { const d=document.createElement('div'); d.textContent=m; d.style.cssText="position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#00a884;color:white;padding:10px 20px;border-radius:20px;z-index:9999;box-shadow:0 2px 5px rgba(0,0,0,0.3)"; document.body.appendChild(d); setTimeout(()=>d.remove(),3000); }
function handleAvatarSelect(e) { if(e.target.files[0]) get('avatarPreview').textContent='📸'; }
function openProfileScreen() { if(myProfile) { get('profileName').value=myProfile.username; get('profilePhone').value=myProfile.phone; } showScreen('profile'); }
function renderFilePreview(f) { if(f.length) get('filePreview').textContent='File: '+f[0].name; }
function showMyQr() { get('qrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(get('profilePhone').value)}`; show(get('modalQr')); }
async function clearChat() { if(activeContact && confirm('Clear?')) { await supabase.from('messages').delete().eq('conversation_id', convIdFor(currentUser.id, activeContact.contact_user)); get('messages').innerHTML=''; } }
function showEmojiPicker() { const d=document.createElement('div'); d.innerHTML='😀 😂 😍 😎 🤔 👍 👎'.split(' ').map(e=>`<span style="font-size:24px;cursor:pointer;padding:5px;">${e}</span>`).join(''); d.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#222;padding:10px;border-radius:10px;z-index:9999;"; d.onclick=e=>{if(e.target.tagName==='SPAN')get('inputMessage').value+=e.target.innerText; d.remove();}; document.body.appendChild(d); }
async function startQrScan() { show(get('modalQrScan')); try { scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}); get('qrVideo').srcObject=scannerStream; } catch(e){alert(e);} }
function stopScanner() { if(scannerStream) scannerStream.getTracks().forEach(t=>t.stop()); }
function handleUrlParams() { const p=new URLSearchParams(location.search); if(p.get('addPhone')) { show(get('modalAddContact')); get('addContactPhone').value=p.get('addPhone'); } }
async function registerPush() { if('serviceWorker' in navigator){ try{const r=await navigator.serviceWorker.register('/sw.js');}catch(e){} } }
function startPresence() { setInterval(()=> { if(currentUser) supabase.from('profiles').update({last_seen:new Date()}).eq('id',currentUser.id); }, 30000); }
window.startCallAction = startCallAction;