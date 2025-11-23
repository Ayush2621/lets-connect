'use strict';

/*
  COMPLETE app.js (IDs preserved, two-way calls fixed, caller UI updates)
  - Uses your TURN credentials (ExpressTURN) to avoid one-way media behind NAT/mobile.
  - Caller and callee bind local tracks to transceivers BEFORE offer/answer (replaceTrack), mirroring audio/video.
  - Caller UI changes from "Calling..." to "Connected" when remote media or answer is applied.
  - Ringtone starts on ringing; stops on accept/media/end.
  - Messaging: Enter key + send button; attachments upload; emoji picker.
  - Defensive checks to avoid null access and console errors.
  - Realtime subscriptions for calls and messages.
*/

const supabase = window.supabase;
if (!supabase) throw new Error('Supabase missing');

// ICE servers: STUN + TURN (ExpressTURN credentials)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  {
    urls: 'turn:relay1.expressturn.com:3480',
    username: '000000002079257160',
    credential: '4jiPPbTEE4gs7pqdEQdY1JXrIaY='
  }
];

// Global state
let currentUser = null;
let myProfile = null;
let myContacts = [];
let activeContact = null;

// Realtime subs
let globalSub = null;
let messageSub = null;

// WebRTC state
let pc = null;
let localStream = null;
let remoteStream = null;
let callsChannel = null;
let currentCallId = null;
let currentRemoteUser = null;
let iceCandidatesQueue = [];

// Media/UX
let audioCtx = null;
let ringtone = null;
let scannerStream = null;

// Helpers
function get(id) { return document.getElementById(id); }
function getVal(id) { const el = get(id); return el ? el.value.trim() : ''; }
function setText(id, val) { const el = get(id); if (el) el.textContent = val; }
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }
function escapeHtml(s) { return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function convIdFor(a,b) { return [a,b].sort().join('_'); }
function on(id, evt, fn) { const el = get(id); if (el) el.addEventListener(evt, fn); }

// Init
document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(()=>{}); }

  // Prime audio context
  document.body.addEventListener('click', () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });

  // Auth
  on('btnSignUp', 'click', handleSignUp);
  on('btnSignIn', 'click', handleSignIn);
  on('btnDemo', 'click', handleDemo);
  on('tabSignIn', 'click', () => switchTab('signin'));
  on('tabSignUp', 'click', () => switchTab('signup'));

  // Profile
  on('btnSaveProfile', 'click', saveProfile);
  on('btnSkipProfile', 'click', skipProfile);
  on('profileAvatar', 'change', handleAvatarSelect);
  on('btnOpenProfile', 'click', openProfileScreen);

  // Contacts
  on('btnAddContactMain', 'click', () => show(get('modalAddContact')));
  on('addContactCancel', 'click', () => hide(get('modalAddContact')));
  on('addContactSave', 'click', saveNewContact);
  on('btnFindByPhone', 'click', saveNewContact);
  on('contactSearch', 'input', (e) => renderContacts(e.target.value));
  on('btnRefresh', 'click', loadContacts);

  // Chat
  on('btnSendMain', 'click', (e) => { e.preventDefault(); sendMessage(); });
  on('inputMessage', 'keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  on('btnAttachMain', 'click', () => get('attachFile')?.click());
  on('attachFile', 'change', (e) => renderFilePreview(e.target.files));
  on('btnEmoji', 'click', showEmojiPicker);
  on('btnClearChat', 'click', clearChat);
  on('btnBackMobile', 'click', () => { get('chatPanel')?.classList.remove('active-screen'); show(get('contactsSection')); hide(get('chatSection')); });

  // Calls
  on('btnVoiceCall', 'click', () => startCallAction(false));
  on('btnVideoCall', 'click', () => startCallAction(true));

  // QR
  on('btnShowQr', 'click', showMyQr);
  on('qrClose', 'click', () => hide(get('modalQr')));
  on('btnScanQr', 'click', startQrScan);
  on('qrScanClose', 'click', () => { stopScanner(); hide(get('modalQrScan')); });

  checkSession();
});

function openProfileScreen() {
  if (myProfile) {
    const n = get('profileName'); if (n) n.value = myProfile.username || '';
    const p = get('profilePhone'); if (p) p.value = myProfile.phone || '';
  }
  showScreen('profile');
}

/* Auth and profile */
async function checkSession() {
  const { data } = await supabase.auth.getSession();
  currentUser = data?.session?.user || null;
  if (!currentUser) showScreen('auth'); else await loadUserProfile();
}
function showScreen(s) { ['authSection','profileSection','appSection'].forEach(id => hide(get(id))); show(get(s + 'Section')); }
function switchTab(t) {
  if (t === 'signin') { hide(get('formSignUp')); show(get('formSignIn')); get('tabSignIn')?.classList.add('active'); get('tabSignUp')?.classList.remove('active'); }
  else { hide(get('formSignIn')); show(get('formSignUp')); get('tabSignUp')?.classList.add('active'); get('tabSignIn')?.classList.remove('active'); }
}
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
    const nameEl = get('profileName'); if (nameEl) nameEl.value = data.username || '';
    const phoneEl = get('profilePhone'); if (phoneEl) phoneEl.value = data.phone || '';
    if (data.avatar_path) {
      const url = await getSignedUrl('avatars', data.avatar_path);
      if (url && get('meAvatar')) get('meAvatar').innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    }
    await loadContacts();
    subscribeToGlobalEvents();
    registerPush();
    startPresence();
    handleUrlParams();
  } else {
    const nameEl = get('profileName'); if (nameEl) nameEl.value = currentUser.email.split('@')[0];
    showScreen('profile');
  }
}
async function saveProfile() {
  const name = getVal('profileName'); const phone = getVal('profilePhone');
  if (!phone) return alert('Phone required');
  const btn = get('btnSaveProfile'); if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
  let avatar_path = myProfile?.avatar_path || null;
  const file = get('profileAvatar')?.files?.[0];
  if (file) {
    avatar_path = `avatars/${currentUser.id}/${Date.now()}_${file.name}`;
    await supabase.storage.from('avatars').upload(avatar_path, file);
  }
  const updateData = { id: currentUser.id, username: name, phone, avatar_path, last_seen: new Date() };
  const { error } = await supabase.from('profiles').upsert(updateData);
  if (error) alert(error.message); else { myProfile = updateData; await loadUserProfile(); }
  if (btn) { btn.textContent = 'Next'; btn.disabled = false; }
}
async function skipProfile() {
  await supabase.from('profiles').upsert({ id: currentUser.id, username: 'User', phone: '', last_seen: new Date() });
  await loadUserProfile();
}

/* Contacts */
async function loadContacts() {
  const list = get('contactsList'); if (!list) return;
  const { data } = await supabase.from('contacts').select('*').eq('owner', currentUser.id);
  myContacts = data || [];
  renderContacts();
}
function renderContacts(filter = '') {
  const list = get('contactsList'); if (!list) return;
  list.innerHTML = '';
  const filtered = myContacts.filter(c => (c.name || '').toLowerCase().includes(filter.toLowerCase()) || (c.phone||'').includes(filter));
  if (!filtered.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:#888">No contacts.</div>'; return; }
  filtered.forEach(c => {
    const div = document.createElement('div'); div.className = 'contact';
    div.innerHTML = `
      <div class="avatar">${(c.name||'U')[0].toUpperCase()}</div>
      <div>
        <div style="font-weight:bold;color:#e9edef;">${escapeHtml(c.name||c.phone)}</div>
        <div style="font-size:12px;color:#8696a0;">${escapeHtml(c.phone||'')}</div>
      </div>`;
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

/* Chat */
async function openChat(contact) {
  if (!contact.contact_user) return alert('User not registered');
  activeContact = contact;
  setText('chatTitle', contact.name || '');
  setText('chatSubtitle', contact.phone || '');
  setText('chatAvatar', (contact.name||'U')[0].toUpperCase());
  show(get('chatSection')); hide(get('contactsSection'));
  if (window.innerWidth < 900) get('chatPanel')?.classList.add('active-screen');
  await loadMessages();
}
async function loadMessages() {
  const container = get('messages'); if (!container) return;
  const convId = convIdFor(currentUser.id, activeContact.contact_user);
  await supabase.from('conversations').upsert({ id: convId });
  const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at');
  container.innerHTML = '';
  if (data?.length) for (const m of data) await renderMessage(m);
  else container.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">No messages</div>';

  if (messageSub) try { messageSub.unsubscribe(); } catch(e){}
  messageSub = supabase.channel('chat:' + convId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, payload => {
      if (!document.getElementById(`msg-${payload.new.id}`)) {
        renderMessage(payload.new);
        if (payload.new.from_user !== currentUser.id) playTone('receive');
      }
    }).subscribe();
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}
async function sendMessage() {
  if (!activeContact) return alert('Open chat first');
  const input = get('inputMessage'); const text = input ? input.value.trim() : '';
  const fileInput = get('attachFile'); const files = fileInput?.files || [];
  if (!text && files.length === 0) return;
  playTone('send'); if (input) input.value = '';
  const convId = convIdFor(currentUser.id, activeContact.contact_user);
  let attachments = [];
  if (files.length > 0) {
    for (const f of files) {
      const path = `attachments/${convId}/${Date.now()}_${f.name}`;
      await supabase.storage.from('attachments').upload(path, f);
      attachments.push({ path, type: f.type, name: f.name });
    }
    if (fileInput) fileInput.value = '';
    const fp = get('filePreview'); if (fp) fp.textContent = '';
  }
  const payload = { conversation_id: convId, from_user: currentUser.id, text, attachments: attachments.length ? JSON.stringify(attachments) : null };
  await supabase.from('messages').insert([payload]);
}
async function renderMessage(msg) {
  const container = get('messages'); if (!container) return;
  if (container.innerHTML.includes('No messages')) container.innerHTML = '';
  const div = document.createElement('div'); div.id = `msg-${msg.id}`;
  div.className = `msg ${msg.from_user === currentUser.id ? 'me' : 'them'}`;
  div.innerHTML = `<div>${escapeHtml(msg.text || '')}</div>
                   <div class="time">${new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>`;
  container.appendChild(div); container.scrollTop = container.scrollHeight;
  if (msg.attachments) {
    try {
      const list = JSON.parse(msg.attachments);
      for (const a of list) {
        const url = await getSignedUrl('attachments', a.path);
        if (!url) continue;
        div.innerHTML += a.type?.startsWith('image')
          ? `<img src="${url}" style="max-width:200px;border-radius:8px;margin-top:5px;">`
          : `<div class="doc-thumb"><a href="${url}" target="_blank">📄 ${escapeHtml(a.name)}</a></div>`;
      }
    } catch(e){}
  }
}
function renderFilePreview(files) {
  const fp = get('filePreview'); if (!fp) return;
  fp.textContent = (files && files.length) ? ('File: ' + files[0].name) : '';
}
function showEmojiPicker() {
  const old = get('emojiPicker'); if (old) old.remove();
  const d = document.createElement('div');
  d.id = 'emojiPicker';
  d.innerHTML = '😀 😂 😍 😎 🤔 👍 👎'.split(' ').map(e=>`<span style="font-size:24px;cursor:pointer;padding:5px;">${e}</span>`).join('');
  d.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#222;padding:10px;border-radius:10px;z-index:9999;";
  d.onclick = e => { if (e.target.tagName === 'SPAN') { const input = get('inputMessage'); if (input) input.value += e.target.innerText; d.remove(); } };
  document.body.appendChild(d);
}
async function clearChat() {
  if (activeContact && confirm('Clear?')) {
    await supabase.from('messages').delete().eq('conversation_id', convIdFor(currentUser.id, activeContact.contact_user));
    const container = get('messages'); if (container) container.innerHTML = '';
  }
}

/* Calls */
async function startCallAction(video) {
  if (!activeContact || !activeContact.contact_user) return alert('Select a contact');

  currentCallId = `call_${Date.now()}`;
  currentRemoteUser = activeContact.contact_user;
  iceCandidatesQueue = [];

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  setupPCListeners();

  // Create transceivers first to stabilize m-line order
  const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const videoTransceiver = video ? pc.addTransceiver('video', { direction: 'sendrecv' }) : null;

  try {
    // Get local media and bind to transceivers via replaceTrack (not addTrack)
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!video });

    const localEl = get('localVideo');
    if (localEl) { localEl.srcObject = localStream; localEl.muted = true; localEl.autoplay = true; localEl.playsInline = true; }

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack && audioTransceiver?.sender) await audioTransceiver.sender.replaceTrack(audioTrack);

    if (video) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack && videoTransceiver?.sender) await videoTransceiver.sender.replaceTrack(videoTrack);
    }
  } catch (err) {
    return alert('Camera/Mic blocked! Check browser permissions.');
  }

  enhancedListenToCallEvents(currentCallId);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const { error } = await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: currentRemoteUser, type: 'offer', payload: JSON.stringify(offer) }]);
    if (error) console.error('Offer insert error:', error.message);
    showOutgoingCallingUI();
  } catch (err) {
    console.warn('OFFER ERROR:', err);
    cleanupCallResources();
  }
}

function setupPCListeners() {
  pc.ontrack = (e) => {
    const remoteEl = get('remoteVideo') || createRemoteVideoElement();

    const stream = (e.streams && e.streams[0])
      ? e.streams[0]
      : (() => { if (!remoteStream) remoteStream = new MediaStream(); remoteStream.addTrack(e.track); return remoteStream; })();

    remoteEl.srcObject = stream;
    remoteEl.muted = false;
    remoteEl.autoplay = true;
    remoteEl.playsInline = true;
    remoteEl.onloadedmetadata = () => remoteEl.play().catch(()=>{});

    updateOutgoingUIConnected();
    stopRinging();
  };

  pc.onicecandidate = async (e) => {
    if (!e.candidate || !currentRemoteUser) return;
    const { error } = await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: currentRemoteUser, type: 'ice', payload: JSON.stringify(e.candidate.toJSON()) }]);
    if (error) console.error('ICE insert error:', error.message);
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return; // prevent null access
    const st = pc.connectionState;
    if (st === 'connected') updateOutgoingUIConnected();
    if (st === 'failed' || st === 'closed' || st === 'disconnected') {
      cleanupCallResources();
    }
  };
}

function enhancedListenToCallEvents(callId) {
  try { callsChannel?.unsubscribe(); } catch(e){}
  callsChannel = supabase.channel('call_' + callId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `call_id=eq.${callId}` }, async ({ new: row }) => {
      if (!row || row.from_user === currentUser.id) return;

      let payload = row.payload;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch(e){} }

      if (row.type === 'answer' && pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        stopRinging();
        processIceQueue();
        updateOutgoingUIConnected();
      } else if (row.type === 'ice' && pc) {
        const ice = new RTCIceCandidate(payload);
        if (pc.remoteDescription) {
          try { await pc.addIceCandidate(ice); } catch(e){}
        } else {
          iceCandidatesQueue.push(ice);
        }
      } else if (row.type === 'cancel' || row.type === 'reject') {
        cleanupCallResources();
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
  if (typeof offerPayload === 'string') { try { offerPayload = JSON.parse(offerPayload); } catch(e){} }
  const offerHasVideo = !!(offerPayload && offerPayload.sdp && offerPayload.sdp.includes('\nm=video'));

  // Mirror transceivers
  const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const videoTransceiver = offerHasVideo ? pc.addTransceiver('video', { direction: 'sendrecv' }) : null;

  try {
    // Add local tracks BEFORE answering, and bind with replaceTrack
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: offerHasVideo });

    const localEl = get('localVideo');
    if (localEl) { localEl.srcObject = localStream; localEl.muted = true; localEl.autoplay = true; localEl.playsInline = true; }

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack && audioTransceiver?.sender) await audioTransceiver.sender.replaceTrack(audioTrack);

    if (offerHasVideo) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack && videoTransceiver?.sender) await videoTransceiver.sender.replaceTrack(videoTrack);
    }
  } catch (err) {
    return alert('Camera/Mic blocked!');
  }

  createRemoteVideoElement();

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offerPayload));
    processIceQueue();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const { error } = await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: currentRemoteUser, type: 'answer', payload: JSON.stringify(answer) }]);
    if (error) console.error('Answer insert error:', error.message);
    stopRinging();
  } catch (err) {
    console.warn('ANSWER ERROR:', err);
  }
}

async function processIceQueue() {
  if (!pc) return;
  for (const c of iceCandidatesQueue) { try { await pc.addIceCandidate(c); } catch(e){} }
  iceCandidatesQueue = [];
}

/* Call UI + teardown */
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
  const a = get('btnAccept'); if (a) a.onclick = () => { stopRinging(); modal.remove(); handleIncomingCall(row); };
  const d = get('btnDecline'); if (d) d.onclick = () => { stopRinging(); modal.remove(); };
}
function showOutgoingCallingUI() {
  if (get('outgoingCallUI')) return;
  ensureRingtone(); try { ringtone.play(); } catch(e){}
  const wrap = document.createElement('div'); wrap.id = 'outgoingCallUI';
  wrap.innerHTML = `<div style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#222;color:white;padding:15px 25px;border-radius:30px;z-index:20000;display:flex;gap:15px;align-items:center;box-shadow:0 5px 15px rgba(0,0,0,0.5);">
    <span id="callStatusText" style="font-weight:bold;">Calling...</span>
    <button id="btnCancelCall" style="background:#ea0038;color:white;border:none;padding:8px 15px;border-radius:15px;font-weight:bold;cursor:pointer;">End</button>
  </div>`;
  document.body.appendChild(wrap);
  get('btnCancelCall')?.addEventListener('click', endCall);
}
function updateOutgoingUIConnected() {
  const status = document.getElementById('callStatusText');
  if (status) status.textContent = 'Connected';
  stopRinging();
}
function createRemoteVideoElement() {
  let v = get('remoteVideo'); if (v) return v;
  v = document.createElement('video');
  v.id = 'remoteVideo';
  v.autoplay = true; v.playsInline = true; v.muted = false;
  v.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#000;object-fit:cover;";
  document.body.appendChild(v);

  const btn = document.createElement('button');
  btn.id = 'endCallBtn';
  btn.textContent = 'END CALL';
  btn.style.cssText = "position:fixed;bottom:50px;left:50%;transform:translateX(-50%);z-index:10000;padding:20px 40px;background:red;color:white;border:none;border-radius:30px;font-weight:bold;font-size:16px;box-shadow:0 4px 10px rgba(0,0,0,0.5);";
  btn.onclick = endCall;
  document.body.appendChild(btn);

  return v;
}
function cleanupCallResources() {
  try { pc?.close(); } catch(e){} pc = null;
  try { localStream?.getTracks().forEach(t => t.stop()); } catch(e){} localStream = null;
  try { remoteStream?.getTracks().forEach(t => t.stop()); } catch(e){} remoteStream = null;
  try { callsChannel?.unsubscribe(); } catch(e){}
  currentCallId = null; currentRemoteUser = null; iceCandidatesQueue = [];
  get('remoteVideo')?.remove();
  get('endCallBtn')?.remove();
  get('outgoingCallUI')?.remove();
  get('incomingCallModal')?.remove();
  stopRinging();
}
async function endCall() {
  if (currentCallId && currentRemoteUser) {
    const { error } = await supabase
      .from('calls')
      .insert([{
        call_id: currentCallId,
        from_user: currentUser.id,
        to_user: currentRemoteUser,
        type: 'cancel',
        payload: '{}'
      }]);
    if (error) console.error('Error sending cancel:', error.message);
  }
  cleanupCallResources();
}

/* Ringtone, QR, misc */
function ensureRingtone() {
  if (ringtone) return;
  ringtone = document.createElement('audio');
  ringtone.src = '/ringtone.mp3'; // must exist in public/
  ringtone.loop = true;
}
function stopRinging() { if (ringtone) { try { ringtone.pause(); } catch(e){} ringtone.currentTime = 0; } }
function subscribeToGlobalEvents() {
  if (globalSub) { try { globalSub.unsubscribe(); } catch(e){} }
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
async function getSignedUrl(bucket, path) {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl;
}
function playTone(kind) {
  try {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = kind === 'send' ? 800 : 600;
    g.gain.value = 0.08;
    o.start(); setTimeout(() => o.stop(), 140);
  } catch(e){}
}
function showMyQr() {
  const img = get('qrImage');
  const val = get('profilePhone')?.value || '';
  if (img) img.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(val)}`;
  show(get('modalQr'));
}
async function startQrScan() {
  show(get('modalQrScan'));
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = get('qrVideo'); if (v) v.srcObject = scannerStream;
  } catch(e){ alert(e); }
}
function stopScanner() { try { scannerStream?.getTracks().forEach(t => t.stop()); } catch(e){} }
function handleUrlParams() {
  const p = new URLSearchParams(location.search);
  if (p.get('addPhone')) { show(get('modalAddContact')); const f = get('addContactPhone'); if (f) f.value = p.get('addPhone'); }
}
async function registerPush() { if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('/sw.js'); } catch(e){} } }
function startPresence() {
  setInterval(() => { if (currentUser) supabase.from('profiles').update({ last_seen: new Date() }).eq('id', currentUser.id); }, 30000);
}
function handleAvatarSelect(e) { const p = get('avatarPreview'); if (p && e.target.files[0]) p.textContent = '📸'; }

// Optional for manual testing
window.startCallAction = startCallAction;


/* ---------------- Manual copy/paste WebRTC UI (no backend) ----------------
   This adds a small modal UI you can open with `showManualRTC()` from console or by calling it from your app.
   It does NOT modify existing call flows — it's an alternate signaling path for testing/connecting directly.
   Uses ICE_SERVERS already defined above (includes TURN). Safe to keep in production; it will not auto-run.
--------------------------------------------------------------------------- */

function createManualRtcModal() {
  if (document.getElementById('manualRtcModal')) return;
  const modal = document.createElement('div');
  modal.id = 'manualRtcModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:99999;';
  modal.innerHTML = `
    <div style="width:860px;max-width:96%;background:#0b1430;padding:16px;border-radius:10px;border:1px solid #1b2a44;color:#dfefff;font-family:system-ui;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>Manual WebRTC — Copy/Paste Signaling</strong>
        <button id="manualCloseBtn" style="background:#2b3b58;border:none;color:white;padding:6px 10px;border-radius:6px;cursor:pointer;">Close</button>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:12px;">
        <video id="manualLocal" autoplay playsinline muted style="width:48%;background:#000;border-radius:8px;"></video>
        <video id="manualRemote" autoplay playsinline style="width:48%;background:#000;border-radius:8px;"></video>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button id="manualStartMedia" style="background:#0277bd;border:none;color:white;padding:8px 10px;border-radius:6px;cursor:pointer;">Start camera & mic</button>
        <button id="manualStopMedia" style="background:#b71c1c;border:none;color:white;padding:8px 10px;border-radius:6px;cursor:pointer;">Stop media</button>
        <button id="manualCreateOffer" style="background:#2e7d32;border:none;color:white;padding:8px 10px;border-radius:6px;cursor:pointer;">Create Offer (Caller)</button>
        <button id="manualCreateAnswer" style="background:#5d4037;border:none;color:white;padding:8px 10px;border-radius:6px;cursor:pointer;">Create Answer from Offer (Callee)</button>
        <button id="manualSetRemote" style="background:#37474f;border:none;color:white;padding:8px 10px;border-radius:6px;cursor:pointer;">Set Remote SDP</button>
      </div>
      <div style="margin-bottom:6px;color:#9fb0c8;font-size:13px;">Offer / Answer SDP (copy & paste between peers):</div>
      <textarea id="manualSdpBox" style="width:100%;height:160px;background:#071129;color:#dfefff;border-radius:6px;border:1px solid #123;padding:8px;font-family:monospace;"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
        <button id="manualCopy" style="background:#00695c;border:none;color:white;padding:8px 10px;border-radius:6px;cursor:pointer;">Copy SDP</button>
        <div id="manualStatus" style="color:#9fb0c8;font-size:13px;">Idle</div>
      </div>
      <div style="margin-top:10px;color:#9fb0c8;font-size:12px;">
        Note: this is for testing/fallback. Use it when your realtime signaling fails. TURN required for restrictive NATs.
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('manualCloseBtn').onclick = () => { stopManualRtc(); modal.remove(); };
  document.getElementById('manualStartMedia').onclick = startManualMedia;
  document.getElementById('manualStopMedia').onclick = stopManualMedia;
  document.getElementById('manualCreateOffer').onclick = manualCreateOffer;
  document.getElementById('manualCreateAnswer').onclick = manualCreateAnswer;
  document.getElementById('manualSetRemote').onclick = manualSetRemote;
  document.getElementById('manualCopy').onclick = async () => {
    const val = document.getElementById('manualSdpBox').value;
    try { await navigator.clipboard.writeText(val); setManualStatus('Copied to clipboard'); } catch(e){ setManualStatus('Copy failed'); }
  };
}

let manualPc = null;
let manualLocalStream = null;

function setManualStatus(s) {
  const el = document.getElementById('manualStatus');
  if (el) el.textContent = s;
  console.log('[ManualRTC]', s);
}

async function startManualMedia() {
  try {
    manualLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const localEl = document.getElementById('manualLocal');
    if (localEl) localEl.srcObject = manualLocalStream;
    setManualStatus('Local media started');
  } catch (e) {
    alert('Error opening camera/mic: ' + e.message);
    setManualStatus('Local media failed');
  }
}
function stopManualMedia() {
  if (manualLocalStream) manualLocalStream.getTracks().forEach(t => t.stop());
  manualLocalStream = null;
  const localEl = document.getElementById('manualLocal');
  if (localEl) localEl.srcObject = null;
  setManualStatus('Local media stopped');
}

function makeManualPc() {
  manualPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  if (manualLocalStream) {
    for (const t of manualLocalStream.getTracks()) manualPc.addTrack(t, manualLocalStream);
  }

  manualPc.ontrack = (e) => {
    const remoteEl = document.getElementById('manualRemote');
    if (!remoteEl) return;
    if (e.streams && e.streams[0]) remoteEl.srcObject = e.streams[0];
    else {
      const ms = new MediaStream(); ms.addTrack(e.track); remoteEl.srcObject = ms;
    }
    setManualStatus('Remote track received');
  };

  manualPc.oniceconnectionstatechange = () => {
    setManualStatus('ICE: ' + manualPc.iceConnectionState);
  };

  manualPc.onicecandidate = (ev) => {
    if (!ev.candidate) setManualStatus('ICE gathering complete — SDP ready');
  };

  return manualPc;
}

function waitForIceGatheringComplete(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    function check() {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        return resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', check);
  }).then(() => pc.localDescription.sdp);
}

async function manualCreateOffer() {
  if (!manualLocalStream) { alert('Start local media first'); return; }
  makeManualPc();
  setManualStatus('Creating offer...');
  const offer = await manualPc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await manualPc.setLocalDescription(offer);
  const sdp = await waitForIceGatheringComplete(manualPc);
  document.getElementById('manualSdpBox').value = sdp;
  setManualStatus('Offer created — copy and send to remote');
}

async function manualCreateAnswer() {
  const txt = document.getElementById('manualSdpBox').value.trim();
  if (!txt) { alert('Paste remote offer SDP into the box first'); return; }
  try {
    const offerDesc = { type: 'offer', sdp: txt };
    makeManualPc();
    await manualPc.setRemoteDescription(offerDesc);
    if (manualLocalStream) {
      for (const t of manualLocalStream.getTracks()) {
        // addTrack is ok for this demo
        try { manualPc.addTrack(t, manualLocalStream); } catch(e){}
      }
    }
    setManualStatus('Creating answer...');
    const answer = await manualPc.createAnswer();
    await manualPc.setLocalDescription(answer);
    const sdp = await waitForIceGatheringComplete(manualPc);
    document.getElementById('manualSdpBox').value = sdp;
    setManualStatus('Answer created — copy and send to caller');
  } catch (e) {
    alert('Error creating answer: ' + e.message);
    setManualStatus('Answer error');
  }
}

async function manualSetRemote() {
  const txt = document.getElementById('manualSdpBox').value.trim();
  if (!txt) return alert('Paste the remote SDP and click Set Remote');
  if (!manualPc) makeManualPc();
  try {
    const isAnswer = manualPc.localDescription && manualPc.localDescription.type === 'offer';
    const remoteType = isAnswer ? 'answer' : 'offer';
    await manualPc.setRemoteDescription({ type: remoteType, sdp: txt });
    setManualStatus('Remote description set (' + remoteType + ')');
  } catch (e) {
    alert('Error setting remote description: ' + e.message);
    setManualStatus('Set remote failed');
  }
}

function stopManualRtc() {
  try { manualPc?.close(); } catch(e){}
  manualPc = null;
  try { if (manualLocalStream) manualLocalStream.getTracks().forEach(t => t.stop()); } catch(e){}
  manualLocalStream = null;
  const el = document.getElementById('manualRtcModal');
  if (el) el.remove();
  setManualStatus('Manual RTC closed');
}

// Expose a function to open the modal (safe; will not auto-run)
window.showManualRTC = function() {
  createManualRtcModal();
  setTimeout(() => { const el = document.getElementById('manualSdpBox'); if (el) el.focus(); }, 200);
};



/* ---------------- Reliable signaling fallback: polling for call events ----------------
   Purpose: Use lightweight DB polling as a fallback when realtime websocket misses events.
   - Non-destructive: doesn't change existing logic; only adds polling layers.
   - Starts a global poll to detect incoming offers to currentUser.
   - Starts a call-specific poll (per call_id) to detect answer/ice/cancel for active calls.
   - Ensures duplicate rows are ignored via processedCallRowIds set.
------------------------------------------------------------------------------- */

let globalPollIntervalId = null;
let callPollIntervalId = null;
const processedCallRowIds = new Set();

// Start global polling for incoming offers when realtime may be unreliable
function startGlobalPoll() {
  stopGlobalPoll();
  if (!currentUser) return;
  // poll every 1500ms
  globalPollIntervalId = setInterval(async () => {
    try {
      const res = await supabase.from('calls').select('*').eq('to_user', currentUser.id).order('created_at', { ascending: true }).limit(20);
      if (res?.data && res.data.length) {
        for (const row of res.data) {
          if (processedCallRowIds.has(row.id)) continue;
          processedCallRowIds.add(row.id);
          // if it's an offer, show incoming popup (same as realtime path)
          if (row.type === 'offer') {
            // call existing handler path (showing popup) but don't auto-accept
            currentRemoteUser = row.from_user;
            showIncomingCallPopup(row);
          }
          // if callee or anyone else inserted something we should handle:
          if (row.type === 'answer' || row.type === 'ice' || row.type === 'cancel' || row.type === 'reject') {
            // pass to enhancedListenToCallEvents logic by invoking the same processing
            // simulate a payload object to the callsChannel handler by reusing enhancedListenToCallRow
            if (typeof handlePolledCallRow === 'function') {
              handlePolledCallRow(row);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[GlobalPoll] error', e);
    }
  }, 1500);
}

function stopGlobalPoll() {
  if (globalPollIntervalId) {
    clearInterval(globalPollIntervalId);
    globalPollIntervalId = null;
  }
}

// Call-specific poll for answer/ice/cancel events for a particular call_id
function startCallPoll(callId) {
  stopCallPoll();
  if (!callId) return;
  callPollIntervalId = setInterval(async () => {
    try {
      const res = await supabase.from('calls').select('*').eq('call_id', callId).order('created_at', { ascending: true }).limit(50);
      if (res?.data && res.data.length) {
        for (const row of res.data) {
          if (processedCallRowIds.has(row.id)) continue;
          processedCallRowIds.add(row.id);
          // ignore events originating from self
          if (row.from_user === currentUser.id) continue;
          // Hand over to handler
          if (typeof handlePolledCallRow === 'function') handlePolledCallRow(row);
        }
      }
    } catch (e) {
      console.warn('[CallPoll] error', e);
    }
  }, 1000);
}

function stopCallPoll() {
  if (callPollIntervalId) {
    clearInterval(callPollIntervalId);
    callPollIntervalId = null;
  }
}

// Central handler reused by realtime and polling to process incoming call rows
function handlePolledCallRow(row) {
  if (!row || !pc && row.type !== 'offer') {
    // if it's an offer and we don't have pc yet, show popup via subscribe path already does that
    // but ensure we call showIncomingCallPopup in case polling caught it
    if (row.type === 'offer') {
      showIncomingCallPopup(row);
    }
    // other rows will be handled below when pc exists
  }

  // parse payload safely
  let payload = row.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch(e) { /* ignore */ }
  }

  if (row.type === 'answer' && pc) {
    pc.setRemoteDescription(new RTCSessionDescription(payload)).catch(e => console.warn('setRemoteDesc(answer) from poll failed', e));
    stopRinging();
    processIceQueue().catch(()=>{});
    updateOutgoingUIConnected();
  } else if (row.type === 'ice' && pc) {
    const ice = new RTCIceCandidate(payload);
    if (pc.remoteDescription) {
      pc.addIceCandidate(ice).catch(e => console.warn('addIceCandidate from poll failed', e));
    } else {
      iceCandidatesQueue.push(ice);
    }
  } else if ((row.type === 'cancel' || row.type === 'reject') && pc) {
    cleanupCallResources();
  } else if (row.type === 'offer') {
    // If offer was polled and no popup shown yet, show it
    showIncomingCallPopup(row);
  }
}

// Integrate polling with existing subscription setup: always start global poll as a robust fallback
// Do this after user session loads; hook into loadUserProfile end. We'll start the poll if user is present.
(function attachPollingStartup() {
  const originalLoadUserProfile = loadUserProfile;
  loadUserProfile = async function() {
    await originalLoadUserProfile.apply(this, arguments);
    // start global poll when profile loads
    try { startGlobalPoll(); } catch(e){ console.warn('startGlobalPoll failed', e); }
  };
})();

// Also, ensure we start a call-specific poll when creating an offer (caller) and stop when call ends.
// We'll wrap startCallAction to start the poll after inserting offer.
(function wrapStartCallAction() {
  const originalStart = startCallAction;
  startCallAction = async function(video) {
    // call original to create pc, get local media and insert offer
    await originalStart.apply(this, arguments);
    // if currentCallId set, start polling for answer/ice
    try {
      if (currentCallId) startCallPoll(currentCallId);
    } catch(e){ console.warn('startCallPoll failed', e); }
  };
})();

// Stop call poll and clear processed rows when cleaning up
(function wrapCleanup() {
  const originalCleanup = cleanupCallResources;
  cleanupCallResources = function() {
    try { stopCallPoll(); } catch(e){}
    // clear processed rows for this call id to avoid memory growth
    // (we don't know the specific row ids tied to callId here; keep processed ids global small enough)
    originalCleanup.apply(this, arguments);
  };
})();

// If user signs out or session lost, stop all polls
(function wrapSignOutCleanup() {
  const originalCheckSession = checkSession;
  checkSession = async function() {
    await originalCheckSession.apply(this, arguments);
    if (!currentUser) {
      stopGlobalPoll();
      stopCallPoll();
    }
  };
})();

// Expose functions for debugging
window._startGlobalPoll = startGlobalPoll;
window._stopGlobalPoll = stopGlobalPoll;
window._startCallPoll = startCallPoll;
window._stopCallPoll = stopCallPoll;

