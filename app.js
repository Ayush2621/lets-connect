'use strict';

/*
  Complete app.js — WhatsApp-like calling behaviour:
  - Incoming popup (Accept/Decline), outgoing Calling UI (Cancel)
  - Reliable remoteStream handling for audio+video
  - Ringtone with local fallback (/mnt/data/ringtone.ogg) and remote fallback
  - Robust ICE signaling via Supabase 'calls' table (offer/answer/ice/reject/cancel)
  - Minimal changes to other app logic / DOM ids (preserved)
*/

/* -------------------- CONFIG / GLOBALS -------------------- */

// Replace with your supabase client (script in index.html should create window.supabase)
const supabase = window.supabase;
if (!supabase) {
  alert('CRITICAL: Supabase client not found. Ensure index.html includes Supabase client and keys.');
  throw new Error('Supabase missing');
}

// Optional: add TURN servers here if needed (WhatsApp uses TURN for NAT traversal in some networks).
// Example: { urls: 'turn:yourturnserver:3478', username: 'user', credential: 'pass' }
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' }
  // Add TURN server entries here if you have them:
  // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
];

// App state
let currentUser = null;        // Supabase auth user object
let myProfile = null;          // profile row from 'profiles' table
let activeContact = null;      // selected contact object { contact_user, name, phone, ... }
let myContacts = [];           // contacts array

// Audio / presence / subscriptions
let audioCtx = null;
let presenceInterval = null;
let messageSub = null;
let globalSub = null;

// WebRTC / call state
let pc = null;
let localStream = null;
let remoteStream = null;       // single MediaStream for incoming audio+video
let callsChannel = null;
let currentCallId = null;
let scannerStream = null;

const BEEP_SOUND = new Audio("data:audio/mp3;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgRYWFgAAAAwAAADbWlub3JfdmVyc2lvbgAwAFRYWFgAAAAkAAADY29tcGF0aWJsZV9icmFuZHMAbXA0Mmlzb21tcDQx//uQZAAAAAAA0AAAAABAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcYAAAAAAABAAAIMwAAAAAS");

// Utility DOM helpers (preserve your HTML ids)
function get(id) { return document.getElementById(id); }
function getVal(id) { return get(id) ? get(id).value.trim() : ''; }
function setText(id, val) { if (get(id)) get(id).textContent = val; }
function setBtn(id, txt, disabled) { const b = get(id); if (b) { b.textContent = txt; b.disabled = disabled; } }
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }
function escapeHtml(s) { return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function convIdFor(a,b) { return [a,b].sort().join('_'); }
const on = (id, evt, fn) => { const el = get(id); if (el) el.addEventListener(evt, fn); };

/* -------------------- APP INIT & BINDINGS -------------------- */

document.addEventListener('DOMContentLoaded', () => {
  // unlock WebAudio on first user gesture
  document.body.addEventListener('click', () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });

  // Auth bindings (IDs must match your HTML)
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
  on('btnAttachMain', 'click', () => get('attachFile').click());
  on('attachFile', 'change', (e) => renderFilePreview(e.target.files));
  on('btnClearChat', 'click', clearChat);
  on('btnEmoji', 'click', showEmojiPicker);

  // Calls
  on('btnVoiceCall', 'click', () => startCallAction(false));
  on('btnVideoCall', 'click', () => startCallAction(true));

  // QR
  on('btnShowQr', 'click', showMyQr);
  on('qrClose', 'click', () => hide(get('modalQr')));
  on('btnScanQr', 'click', startQrScan);
  on('qrScanClose', 'click', () => { stopScanner(); hide(get('modalQrScan')); });

  // Start
  checkSession();
});

/* -------------------- AUTH / PROFILE / CONTACTS / CHAT -------------------- */
/* NOTE: These functions are preserved from your app; I include full versions
   so this file is self-contained. They were not changed except where noted. */

async function checkSession() {
  try {
    const { data } = await supabase.auth.getSession();
    currentUser = data?.session?.user || null;
    if (!currentUser) showScreen('auth');
    else await loadUserProfile();
  } catch (err) {
    console.error(err);
    showScreen('auth');
  }
}

function switchTab(t) {
  if (t === 'signin') {
    hide(get('formSignUp')); show(get('formSignIn'));
    get('tabSignIn').classList.add('active'); get('tabSignUp').classList.remove('active');
  } else {
    hide(get('formSignIn')); show(get('formSignUp'));
    get('tabSignUp').classList.add('active'); get('tabSignIn').classList.remove('active');
  }
}

function showScreen(s) {
  ['authSection','profileSection','appSection'].forEach(id => hide(get(id)));
  show(get(s + 'Section'));
}

async function handleSignIn() {
  const email = getVal('signinEmail'); const pass = getVal('signinPass');
  if (!email || !pass) return alert('Enter email and password');
  setBtn('btnSignIn','Logging in...',true);
  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) { alert(error.message); setBtn('btnSignIn','Log In',false); } else checkSession();
}

async function handleSignUp() {
  const email = getVal('signupEmail'); const pass = getVal('signupPass');
  if (!email || pass.length < 6) return alert('Valid email & 6+ char password required');
  setBtn('btnSignUp','Creating...',true);
  const { error } = await supabase.auth.signUp({ email, password: pass });
  if (error) { alert(error.message); setBtn('btnSignUp','Sign Up',false); } else { await supabase.auth.signInWithPassword({ email, password: pass }); checkSession(); }
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
      if (url) get('meAvatar').innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    }
    loadContacts();
    subscribeToGlobalEvents();
    registerPush();
    startPresence();
    handleUrlParams();
  } else {
    get('profileName').value = currentUser.email.split('@')[0];
    get('avatarPreview').textContent = currentUser.email[0].toUpperCase();
    showScreen('profile');
  }
}

async function saveProfile() {
  const name = getVal('profileName'); const phone = getVal('profilePhone');
  if (!phone) return alert('Phone number required');
  setBtn('btnSaveProfile','Saving...',true);
  let avatar_path = myProfile?.avatar_path || null;
  if (get('profileAvatar') && get('profileAvatar').files[0]) {
    const f = get('profileAvatar').files[0];
    avatar_path = `avatars/${currentUser.id}/${Date.now()}.png`;
    await supabase.storage.from('avatars').upload(avatar_path, f);
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
  get('contactsList').innerHTML = '<div style="padding:20px;text-align:center;color:#888">Loading...</div>';
  const { data } = await supabase.from('contacts').select('*').eq('owner', currentUser.id);
  myContacts = data || [];
  renderContacts();
}

function renderContacts(filter = '') {
  const list = get('contactsList'); if (!list) return;
  list.innerHTML = '';
  const filtered = myContacts.filter(c => (c.name || '').toLowerCase().includes(filter.toLowerCase()) || (c.phone||'').includes(filter));
  if (filtered.length === 0) { list.innerHTML = '<div style="padding:20px;text-align:center;color:#888">No contacts.</div>'; return; }
  filtered.forEach(c => {
    const div = document.createElement('div');
    div.className = 'contact';
    div.innerHTML = `<div class="avatar">${(c.name||'U')[0].toUpperCase()}</div><div><div style="font-weight:bold;color:#e9edef;">${escapeHtml(c.name||c.phone)}</div><div style="font-size:12px;color:#8696a0;">${escapeHtml(c.phone||'')}</div></div>`;
    div.onclick = () => openChat(c);
    list.appendChild(div);
  });
}

async function saveNewContact() {
  const phone = getVal('addContactPhone'); const name = getVal('addContactName');
  if (!phone) return alert('Phone number required');
  const { data: user } = await supabase.from('profiles').select('*').eq('phone', phone).maybeSingle();
  const newContact = { owner: currentUser.id, phone, name: name || (user ? user.username : phone), contact_user: user ? user.id : null };
  await supabase.from('contacts').insert([newContact]);
  hide(get('modalAddContact'));
  loadContacts();
  if (!user) alert('Contact added! They must register to chat.');
}

async function openChat(contact) {
  if (!contact.contact_user) return alert('This contact has not registered yet.');
  activeContact = contact;
  setText('chatTitle', contact.name);
  setText('chatSubtitle', contact.phone);
  setText('chatAvatar', (contact.name||'U')[0].toUpperCase());
  if (window.innerWidth < 900) get('chatPanel').classList.add('active-screen');
  loadMessages();
}

async function loadMessages() {
  const container = get('messages');
  container.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">Loading...</div>';
  const convId = convIdFor(currentUser.id, activeContact.contact_user);
  const { error: upsertError } = await supabase.from('conversations').upsert({ id: convId });
  if (upsertError) console.warn("Conversation init error (ignore if duplicate):", upsertError);
  const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at');
  container.innerHTML = '';
  if (data && data.length > 0) {
    for (const m of data) await renderMessage(m);
  } else {
    container.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">No messages yet</div>';
  }
  if (messageSub) messageSub.unsubscribe();
  messageSub = supabase.channel('chat:' + convId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, payload => {
      const existing = document.getElementById(`msg-${payload.new.id}`);
      if (!existing) {
        renderMessage(payload.new);
        if (payload.new.from_user !== currentUser.id) playTone('receive');
      }
    })
    .subscribe();
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}

async function sendMessage() {
  if (!activeContact) return alert('Open a chat first');
  const text = getVal('inputMessage');
  const files = get('attachFile').files;
  if (!text && files.length === 0) return;
  playTone('send');
  get('inputMessage').value = '';
  const convId = convIdFor(currentUser.id, activeContact.contact_user);
  let attachments = [];
  if (files.length > 0) {
    for (const f of files) {
      const path = `attachments/${convId}/${Date.now()}_${f.name}`;
      await supabase.storage.from('attachments').upload(path, f);
      attachments.push({ path, type: f.type, name: f.name });
    }
    get('attachFile').value = '';
    get('filePreview').innerHTML = '';
  }
  const payload = { conversation_id: convId, from_user: currentUser.id, text, attachments: attachments.length ? JSON.stringify(attachments) : null };
  const tempId = `temp-${Date.now()}`;
  renderMessage({ ...payload, created_at: new Date().toISOString(), id: tempId });
  const { data, error } = await supabase.from('messages').insert([payload]).select();
  if (error) {
    alert('Message failed: ' + error.message);
  } else if (data && data[0]) {
    const tempEl = document.getElementById(`msg-${tempId}`);
    if (tempEl) tempEl.id = `msg-${data[0].id}`;
  }
  try { sendPush(activeContact.contact_user, 'New Message', text || 'Sent a file'); } catch(e) {}
}

function renderMessage(msg) {
  const container = get('messages');
  if (container.innerHTML.includes('No messages yet') || container.innerHTML.includes('Loading...')) container.innerHTML = '';
  const div = document.createElement('div');
  div.id = `msg-${msg.id}`;
  div.className = `msg ${msg.from_user === currentUser.id ? 'me' : 'them'}`;
  let content = `<div>${escapeHtml(msg.text)}</div>`;
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = content + `<div class="time">${time}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  if (msg.attachments) {
    try {
      const atts = JSON.parse(msg.attachments);
      const attDiv = document.createElement('div'); attDiv.className = 'att';
      div.insertBefore(attDiv, div.lastChild);
      atts.forEach(async (a) => {
        const url = await getSignedUrl('attachments', a.path);
        if (url) {
          let html = '';
          if (a.type.startsWith('image')) html = `<img src="${url}" class="file-thumb" style="max-width:200px;border-radius:8px;margin-top:5px;display:block;">`;
          else if (a.type.startsWith('video')) html = `<video src="${url}" controls class="file-thumb" style="max-width:200px;border-radius:8px;margin-top:5px;display:block;"></video>`;
          else html = `<div class="doc-thumb"><a href="${url}" target="_blank">📄 ${a.name}</a></div>`;
          attDiv.innerHTML += html;
        }
      });
    } catch (e) {}
  }
}

/* -------------------- CALLING SYSTEM (WhatsApp-like) -------------------- */

/*
  Signaling DB schema expectation (table 'calls'):
  - call_id (string)
  - from_user (user id)
  - to_user (user id)
  - type (offer | answer | ice | reject | cancel)
  - payload (json or text)
*/

/* START A CALL (caller flow) */
async function startCallAction(video) {
  if (!activeContact || !activeContact.contact_user) return alert('Select a contact who is registered');
  const remoteId = activeContact.contact_user;
  currentCallId = `call_${Date.now()}`;

  // Create RTCPeerConnection with configured ICE servers
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Logging for debugging
  pc.oniceconnectionstatechange = () => console.log('ICE state:', pc.iceConnectionState);
  pc.onconnectionstatechange = () => console.log('Connection state:', pc.connectionState);
  pc.onicecandidateerror = (e) => console.warn('Candidate error', e);

  // obtain local media (audio always, video optional)
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: !!video, audio: true });
    // show small preview in chat avatar area
    const v = document.createElement('video'); v.autoplay = true; v.muted = true; v.playsInline = true;
    v.srcObject = localStream; v.style.width = '40px'; v.style.height = '40px'; v.style.objectFit = 'cover';
    if (get('chatAvatar')) { get('chatAvatar').innerHTML = ''; get('chatAvatar').appendChild(v); }
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  } catch (err) {
    return alert('Camera/mic permission error: ' + (err.message || err));
  }

  // create remoteStream placeholder
  remoteStream = new MediaStream();

  // ensure remote tracks get added reliably
  pc.ontrack = (e) => {
    if (!remoteStream) remoteStream = new MediaStream();
    try { remoteStream.addTrack(e.track); } catch (ex) { console.warn('addTrack failed', ex); }
    const rv = document.getElementById('remoteVideo');
    if (rv) {
      rv.srcObject = remoteStream;
      rv.muted = false;
      rv.volume = 1;
      try { rv.play().catch(()=>{}); } catch(e){}
    } else {
      showRemoteVideo(remoteStream);
    }
  };

  // send ICE candidates to DB
  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;
    const candidateObj = e.candidate.toJSON ? e.candidate.toJSON() : e.candidate;
    const payload = JSON.stringify(candidateObj);
    try {
      await supabase.from('calls').insert([{
        call_id: currentCallId,
        from_user: currentUser.id,
        to_user: remoteId,
        type: 'ice',
        payload
      }]);
    } catch (err) { console.warn('send ICE failed', err); }
  };

  // Create offer
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await supabase.from('calls').insert([{
      call_id: currentCallId,
      from_user: currentUser.id,
      to_user: remoteId,
      type: 'offer',
      payload: JSON.stringify(offer)
    }]);

    // Optional push
    try { sendPush(remoteId, 'Incoming Call', `Call from ${myProfile?.username || 'Unknown'}`); } catch(e){}

    // Show caller UI + play ringtone
    showOutgoingCallingUI(currentCallId, remoteId);
    enhancedListenToCallEvents(currentCallId);
  } catch (err) {
    alert('Call start failed: ' + (err.message || err));
    cleanupCallResources();
  }
}

/* LISTEN TO SIGNALS FOR A SPECIFIC CALL */
function enhancedListenToCallEvents(callId) {
  if (callsChannel) {
    try { callsChannel.unsubscribe(); } catch(e) {}
    callsChannel = null;
  }

  callsChannel = supabase.channel('call_' + callId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `call_id=eq.${callId}` }, async ({ new: row }) => {
      if (!row) return;
      // If this row was created by currentUser, handle only specific types
      if (row.from_user === currentUser.id) {
        if (row.type === 'reject' || row.type === 'cancel') {
          removeOutgoingCallingUI(); cleanupCallResources();
        }
        return;
      }

      // Receiver side: show popup if it's an offer
      if (row.type === 'offer') { showIncomingCallPopup(row); return; }
      if (row.type === 'cancel') { removeIncomingModal(); stopRinging(); return; }
      if (row.type === 'reject') { removeOutgoingCallingUI(); cleanupCallResources(); return; }

      // Normalize payload
      let payload = row.payload;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch(e) {}
      }

      try {
        if (row.type === 'answer' && pc) {
          const desc = { type: payload.type, sdp: payload.sdp };
          await pc.setRemoteDescription(new RTCSessionDescription(desc));
          removeOutgoingCallingUI(); stopRinging();
        } else if (row.type === 'ice' && pc) {
          const candidate = payload.candidate || payload;
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (e) {
        console.warn('Signal handling error', e);
      }
    }).subscribe();
}

/* GLOBAL SUBSCRIPTION FOR OFFERS DIRECTED AT CURRENT USER */
function subscribeToGlobalEvents() {
  if (globalSub) { try { globalSub.unsubscribe(); } catch(e) {} globalSub = null; }

  globalSub = supabase.channel('user_global_' + currentUser.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `to_user=eq.${currentUser.id}` }, async ({ new: row }) => {
      if (!row) return;
      if (row.type === 'offer') {
        // Show incoming popup (do not auto-accept)
        showIncomingCallPopup(row);
      } else if (row.type === 'ice') {
        const payload = (typeof row.payload === 'string') ? JSON.parse(row.payload) : row.payload;
        if (pc && row.call_id === currentCallId && payload) {
          try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate || payload)); } catch(e) {}
        }
      }
    })
    // Also keep message notifications
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if (payload.new.from_user !== currentUser.id) {
        if (!activeContact || activeContact.contact_user !== payload.new.from_user) {
          showToast('New Message Received!');
          playTone('receive');
        }
      }
    }).subscribe();
}

/* HANDLE ACCEPTING AN INCOMING CALL */
async function handleIncomingCall(row) {
  // Called when user Accepts incoming popup
  playTone('receive');
  currentCallId = row.call_id;
  enhancedListenToCallEvents(currentCallId);

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.oniceconnectionstatechange = () => console.log('ICE state (answerer):', pc.iceConnectionState);
  pc.onconnectionstatechange = () => console.log('PC state (answerer):', pc.connectionState);

  // Parse offer payload
  let offerPayload = row.payload;
  if (typeof offerPayload === 'string') {
    try { offerPayload = JSON.parse(offerPayload); } catch(e) {}
  }
  const wantsVideo = offerPayload && offerPayload.sdp && offerPayload.sdp.includes('m=video');

  // get local media
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: wantsVideo, audio: true });
    for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  } catch (err) {
    alert('Could not access camera/mic: ' + (err.message || err));
    return;
  }

  // prepare remoteStream and attach
  remoteStream = new MediaStream();
  showRemoteVideo(null);

  pc.ontrack = (e) => {
    if (!remoteStream) remoteStream = new MediaStream();
    try { remoteStream.addTrack(e.track); } catch (ex) { console.warn('addTrack fail', ex); }
    const remoteEl = document.getElementById('remoteVideo');
    if (remoteEl) {
      remoteEl.srcObject = remoteStream;
      remoteEl.muted = false;
      remoteEl.volume = 1.0;
      try { remoteEl.play().catch(()=>{}); } catch(e) {}
    }
  };

  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;
    const payload = JSON.stringify(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
    try {
      await supabase.from('calls').insert([{
        call_id: currentCallId,
        from_user: currentUser.id,
        to_user: row.from_user,
        type: 'ice',
        payload
      }]);
    } catch (err) { console.warn('Failed to send ICE (answerer):', err); }
  };

  try {
    const offerDesc = (typeof offerPayload === 'object') ? offerPayload : JSON.parse(String(row.payload));
    await pc.setRemoteDescription(new RTCSessionDescription({ type: offerDesc.type, sdp: offerDesc.sdp }));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await supabase.from('calls').insert([{
      call_id: currentCallId,
      from_user: currentUser.id,
      to_user: row.from_user,
      type: 'answer',
      payload: JSON.stringify(answer)
    }]);

    enhancedListenToCallEvents(currentCallId);
  } catch (err) {
    alert('Call setup failed: ' + (err.message || err));
    cleanupCallResources();
  }
}

/* CREATE / ATTACH REMOTE VIDEO ELEMENT */
function showRemoteVideo(stream) {
  const existing = document.getElementById('remoteVideo');
  if (existing) existing.remove();

  const v = document.createElement('video');
  v.id = 'remoteVideo';
  v.autoplay = true;
  v.playsInline = true;
  v.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:black;object-fit:contain;";
  if (remoteStream) v.srcObject = remoteStream;
  else if (stream) v.srcObject = stream;
  v.muted = false;
  v.volume = 1.0;
  document.body.appendChild(v);

  // End Call button
  let btn = document.getElementById('endCallBtn');
  if (btn) btn.remove();
  btn = document.createElement('button');
  btn.id = 'endCallBtn';
  btn.innerText = "End Call";
  btn.style.cssText = "position:fixed;bottom:50px;left:50%;transform:translateX(-50%);z-index:10000;padding:15px 30px;background:red;color:white;border:none;border-radius:30px;font-weight:bold;";
  btn.onclick = () => { endCall(); };
  document.body.appendChild(btn);
}

/* CLEANUP */
function cleanupCallResources() {
  try { if (pc) pc.close(); } catch(e) {}
  pc = null;
  try { if (localStream) localStream.getTracks().forEach(t => t.stop()); } catch(e) {}
  localStream = null;
  try { if (remoteStream) remoteStream.getTracks().forEach(t => t.stop()); } catch(e) {}
  remoteStream = null;
  try { if (callsChannel) callsChannel.unsubscribe(); } catch(e) {}
  callsChannel = null;
  currentCallId = null;
  const rv = document.getElementById('remoteVideo'); if (rv) rv.remove();
  const btn = document.getElementById('endCallBtn'); if (btn) btn.remove();
  const out = document.getElementById('outgoingCallUI'); if (out) out.remove();
  const inc = document.getElementById('incomingCallModal'); if (inc) inc.remove();
  stopRinging();
}

function endCall() {
  cleanupCallResources();
  if (get('chatAvatar')) get('chatAvatar').textContent = (myProfile?.username || 'U')[0] || 'U';
}

/* -------------------- RINGTONE + UI -------------------- */

/*
  For apps (packaged/capacitor), include a local ringtone at /mnt/data/ringtone.ogg
  so sound plays without network. If absent, remote fallback will be used.
*/
let ringtone = null;
function ensureRingtone() {
  if (ringtone) return;
  ringtone = document.createElement('audio');
  const localPath = '/mnt/data/ringtone.ogg';
  ringtone.src = localPath;
  ringtone.onerror = () => {
    console.warn('Local ringtone load failed — falling back to remote ringtone');
    ringtone.src = 'https://actions.google.com/sounds/v1/alarms/phone_ringing.ogg';
  };
  ringtone.loop = true;
  ringtone.volume = 0.8;
  ringtone.id = 'app_ringtone';
  document.body.appendChild(ringtone);
}
function stopRinging() { if (ringtone) { try { ringtone.pause(); ringtone.currentTime = 0; } catch(e){} } if (audioCtx && audioCtx.state === 'suspended') try { audioCtx.resume(); } catch(e){} }

function removeIncomingModal() { const m = document.getElementById('incomingCallModal'); if (m) m.remove(); }
function removeOutgoingCallingUI() { const el = document.getElementById('outgoingCallUI'); if (el) el.remove(); stopRinging(); }

/* Incoming call popup */
function showIncomingCallPopup(callRow) {
  if (document.getElementById('incomingCallModal')) return;
  ensureRingtone();
  try { ringtone.play().catch(()=>{}); } catch(e){}

  const caller = callRow.from_user || 'Unknown';
  const modal = document.createElement('div'); modal.id = 'incomingCallModal';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:20000;';
  const backdrop = document.createElement('div'); backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);'; modal.appendChild(backdrop);

  const card = document.createElement('div'); card.style.cssText = 'position:relative;min-width:320px;padding:18px;border-radius:12px;background:#111;color:#fff;display:flex;flex-direction:column;align-items:center;gap:12px;z-index:20001;box-shadow:0 10px 30px rgba(0,0,0,0.6);';
  modal.appendChild(card);
  const title = document.createElement('div'); title.innerText = 'Incoming Call'; title.style.fontSize = '18px'; title.style.fontWeight = '700'; card.appendChild(title);
  const who = document.createElement('div'); who.innerText = `From: ${caller}`; who.style.opacity = '0.9'; card.appendChild(who);

  const btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:12px;margin-top:6px;';
  const accept = document.createElement('button'); accept.innerText = 'Accept'; accept.style.cssText = 'padding:10px 16px;border-radius:8px;background:green;color:white;border:none;font-weight:600;';
  const decline = document.createElement('button'); decline.innerText = 'Decline'; decline.style.cssText = 'padding:10px 16px;border-radius:8px;background:#333;color:white;border:none;font-weight:600;';
  btns.appendChild(accept); btns.appendChild(decline); card.appendChild(btns);
  document.body.appendChild(modal);

  accept.onclick = async () => {
    stopRinging(); removeIncomingModal();
    try { await handleIncomingCall(callRow); } catch (err) { console.warn('Accept handler error', err); }
  };

  decline.onclick = async () => {
    stopRinging(); removeIncomingModal();
    try {
      await supabase.from('calls').insert([{
        call_id: callRow.call_id,
        from_user: currentUser.id,
        to_user: callRow.from_user,
        type: 'reject',
        payload: JSON.stringify({ reason: 'declined' })
      }]);
    } catch (err) { console.warn('Reject send failed', err); }
  };
}

/* Outgoing calling UI */
function showOutgoingCallingUI(callId, calleeId) {
  if (document.getElementById('outgoingCallUI')) return;
  ensureRingtone();
  try { ringtone.play().catch(()=>{}); } catch(e){}
  const container = document.createElement('div');
  container.id = 'outgoingCallUI';
  container.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);z-index:20000;background:#0d0d0d;color:#fff;padding:12px 16px;border-radius:20px;display:flex;align-items:center;gap:12px;box-shadow:0 6px 20px rgba(0,0,0,0.5);';
  container.innerHTML = `<div style="font-weight:600">Calling ${escapeHtml(calleeId)}...</div>`;
  const cancel = document.createElement('button'); cancel.innerText = 'Cancel'; cancel.style.cssText = 'padding:8px 12px;border-radius:12px;background:#333;color:#fff;border:none;font-weight:600;';
  cancel.onclick = async () => {
    stopRinging(); const el = document.getElementById('outgoingCallUI'); if (el) el.remove();
    try {
      await supabase.from('calls').insert([{
        call_id: callId,
        from_user: currentUser.id,
        to_user: calleeId,
        type: 'cancel',
        payload: JSON.stringify({ reason: 'caller_cancelled' })
      }]);
    } catch (err) { console.warn('Cancel send failed', err); }
    cleanupCallResources();
  };
  container.appendChild(cancel); document.body.appendChild(container);
}

/* -------------------- UTILITIES -------------------- */

async function getSignedUrl(bucket, path) {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl;
}

function playTone(type) {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (!audioCtx) return BEEP_SOUND.play().catch(()=>{});
  const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
  osc.connect(g); g.connect(audioCtx.destination);
  osc.frequency.value = (type === 'send') ? 800 : 600;
  g.gain.value = 0.1; osc.start(); setTimeout(()=>osc.stop(),150);
}

async function sendPush(uid, title, body) {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;
  fetch('/api/send-push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toUserId: uid, title, message: body }) })
    .then(res => { if (!res.ok) console.warn('Push API returned', res.status); })
    .catch(e => console.warn('Push failed', e));
}

function showToast(msg) {
  const d = document.createElement('div'); d.textContent = msg;
  d.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#00a884;color:#fff;padding:10px 20px;border-radius:20px;z-index:99999;box-shadow:0 2px 10px rgba(0,0,0,0.3);";
  document.body.appendChild(d); setTimeout(()=>d.remove(),3000);
}

/* -------------------- QR / PRESENCE / PUSH / MISC -------------------- */

function handleAvatarSelect(e) { if (e.target.files[0]) get('avatarPreview').innerHTML = '📸'; }
function openProfileScreen() { if (myProfile) { get('profileName').value = myProfile.username || ''; get('profilePhone').value = myProfile.phone || ''; } showScreen('profile'); }
function closeChatPanel() { if (get('chatPanel')) get('chatPanel').classList.remove('active-screen'); activeContact = null; }
function renderFilePreview(files) { if (files.length) get('filePreview').innerHTML = `📄 ${files[0].name}`; }
function showMyQr() { const ph = myProfile?.phone || get('profilePhone').value; if (!ph) return alert('No phone set. Save profile first.'); get('qrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(ph)}`; show(get('modalQr')); }

async function clearChat() { if (!activeContact) return; if (confirm('Delete?')) { await supabase.from('messages').delete().eq('conversation_id', convIdFor(currentUser.id, activeContact.contact_user)); get('messages').innerHTML = ''; } }

function showEmojiPicker() {
  const picker = document.createElement('div');
  picker.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#202c33;padding:10px;border-radius:10px;display:grid;grid-template-columns:repeat(8,1fr);gap:5px;z-index:9999;";
  ['😀','😂','😍','😎','🤔','👍','👎','🎉','❤️','😭','👀','🔥','🙏','💯','👋','✨'].forEach(em => {
    const b = document.createElement('div'); b.textContent = em; b.style.fontSize = '24px'; b.style.cursor = 'pointer';
    b.onclick = (e) => { e.stopPropagation(); get('inputMessage').value += em; picker.remove(); };
    picker.appendChild(b);
  });
  document.body.appendChild(picker);
  setTimeout(() => { document.addEventListener('click', e => { if (!picker.contains(e.target)) picker.remove(); }, { once: true }); }, 100);
}

/* QR scanning (BarcodeDetector when available) */
async function startQrScan() {
  if (!window.BarcodeDetector) return handleScannedText(prompt('Paste QR data:'));
  show(get('modalQrScan'));
  try {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = get('qrVideo'); v.srcObject = scannerStream;
    const loop = async () => {
      try {
        const b = await createImageBitmap(v);
        const res = await detector.detect(b);
        if (res.length) { stopScanner(); hide(get('modalQrScan')); handleScannedText(res[0].rawValue); return; }
      } catch (e) {}
      if (!get('modalQrScan').classList.contains('hidden')) requestAnimationFrame(loop);
    };
    loop();
  } catch (e) { alert('Cam error: ' + e.message); hide(get('modalQrScan')); }
}
function stopScanner() { if (scannerStream) scannerStream.getTracks().forEach(t => t.stop()); }
function handleScannedText(txt) { if (!txt) return; if (txt.includes('addPhone=')) get('addContactPhone').value = new URL(txt).searchParams.get('addPhone'); else get('addContactPhone').value = txt; saveNewContact(); }
function handleUrlParams() { const params = new URLSearchParams(location.search); const addPhone = params.get('addPhone'); if (addPhone) { show(get('modalAddContact')); get('addContactPhone').value = addPhone; window.history.replaceState({}, document.title, "/"); } }

async function registerPush() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY) });
      await supabase.from('push_subscriptions').upsert({ user_id: currentUser.id, endpoint: sub.endpoint, p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))) }, { onConflict: 'endpoint' });
    } catch (e) { console.warn('Push register failed', e); }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function startPresence() {
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(() => {
    if (!currentUser) return;
    supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', currentUser.id).then(({ error }) => {
      if (error) console.warn('Presence update failed:', error);
    });
  }, 15000);
}

/* Expose core functions for existing UI */
window.startCallAction = startCallAction;
window.endCall = endCall;
window.subscribeToGlobalEvents = subscribeToGlobalEvents;
window.cleanupCallResources = cleanupCallResources;

console.log('app.js loaded —  calling enabled (incoming popup, outgoing UI, ringtone).');

