'use strict';

// --- 1. GLOBAL SETUP ---
const supabase = window.supabase;
if (!supabase) {
    alert('CRITICAL ERROR: Supabase client not found. Check index.html.');
    throw new Error('Supabase missing');
}

// Reliable Base64 Beep
const BEEP_SOUND = new Audio("data:audio/mp3;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgRYWFgAAAAwAAADbWlub3JfdmVyc2lvbgAwAFRYWFgAAAAkAAADY29tcGF0aWJsZV9icmFuZHMAbXA0Mmlzb21tcDQx//uQZAAAAAAA0AAAAABAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcYAAAAAAABAAAIMwAAAAAS"); 

// State - Defined Globally to prevent ReferenceErrors
let currentUser = null;
let myProfile = null;
let activeContact = null;
let myContacts = [];
let audioCtx = null; 
let presenceInterval = null;
let messageSub = null; // GLOBAL DEFINITION
let globalSub = null;  // GLOBAL DEFINITION

// WebRTC
let pc = null;
let localStream = null;
let callsChannel = null;
let currentCallId = null;
let scannerStream = null;

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

// --- HELPER FUNCTIONS ---
function get(id) { return document.getElementById(id); }
function getVal(id) { return get(id) ? get(id).value.trim() : ''; }
function setText(id, val) { if(get(id)) get(id).textContent = val; }
function setBtn(id, txt, disabled) { const b=get(id); if(b){ b.textContent=txt; b.disabled=disabled; } }
function hide(el) { if(el) el.classList.add('hidden'); }
function show(el) { if(el) el.classList.remove('hidden'); }
function escapeHtml(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function convIdFor(a, b) { return [a, b].sort().join('_'); }

// Helper: Safe Event Listener
const on = (id, event, handler) => {
    const el = get(id);
    if (el) el.addEventListener(event, handler);
};

// --- 2. INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('App Initializing...');

    // Unlock Audio
    document.body.addEventListener('click', () => {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });

    // --- BINDINGS ---
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

    // Navigation
    on('btnBackMobile', 'click', closeChatPanel);

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

    // Call
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

/* =========================================
   3. LOGIC
   ========================================= */

function switchTab(t) {
    if (t === 'signin') { hide(get('formSignUp')); show(get('formSignIn')); get('tabSignIn').classList.add('active'); get('tabSignUp').classList.remove('active'); }
    else { hide(get('formSignIn')); show(get('formSignUp')); get('tabSignUp').classList.add('active'); get('tabSignIn').classList.remove('active'); }
}

function showScreen(s) {
    ['authSection', 'profileSection', 'appSection'].forEach(id => hide(get(id)));
    show(get(s + 'Section'));
}

// --- AUTH ---
async function checkSession() {
    try {
        const { data } = await supabase.auth.getSession();
        currentUser = data?.session?.user || null;
        if (!currentUser) showScreen('auth');
        else await loadUserProfile();
    } catch (err) { console.error(err); showScreen('auth'); }
}

async function handleSignIn() {
    const email = getVal('signinEmail');
    const pass = getVal('signinPass');
    if (!email || !pass) return alert('Enter email and password');
    
    setBtn('btnSignIn', 'Logging in...', true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) { alert(error.message); setBtn('btnSignIn', 'Log In', false); }
    else checkSession();
}

async function handleSignUp() {
    const email = getVal('signupEmail');
    const pass = getVal('signupPass');
    if (!email || pass.length < 6) return alert('Valid email & 6+ char password required');

    setBtn('btnSignUp', 'Creating...', true);
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) { alert(error.message); setBtn('btnSignUp', 'Sign Up', false); }
    else { await supabase.auth.signInWithPassword({ email, password: pass }); checkSession(); }
}

async function handleDemo() {
    const email = `demo${Date.now()}@test.com`;
    const pass = 'password123';
    await supabase.auth.signUp({ email, password: pass });
    await supabase.auth.signInWithPassword({ email, password: pass });
    checkSession();
}

// --- PROFILE ---
async function loadUserProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if (data) {
        myProfile = data;
        showScreen('app');
        setText('meName', data.username || 'Me');
        setText('mePhone', data.phone || '');
        
        // Pre-fill profile inputs
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
    const name = getVal('profileName');
    const phone = getVal('profilePhone');
    if (!phone) return alert('Phone number required');

    setBtn('btnSaveProfile', 'Saving...', true);
    let avatar_path = myProfile?.avatar_path || null;
    if (get('profileAvatar').files[0]) {
        const f = get('profileAvatar').files[0];
        avatar_path = `avatars/${currentUser.id}/${Date.now()}.png`;
        await supabase.storage.from('avatars').upload(avatar_path, f);
    }

    const updateData = { id: currentUser.id, username: name, phone, avatar_path, last_seen: new Date() };
    const { error } = await supabase.from('profiles').upsert(updateData);
    
    if (error) alert(error.message);
    else {
        myProfile = updateData; 
        await loadUserProfile();
    }
    setBtn('btnSaveProfile', 'Next', false);
}

async function skipProfile() {
    await supabase.from('profiles').upsert({ id: currentUser.id, username: 'User', phone: '', last_seen: new Date() });
    await loadUserProfile();
}

// --- CONTACTS ---
async function loadContacts() {
    if (!get('contactsList')) return;
    get('contactsList').innerHTML = '<div style="padding:20px;text-align:center;color:#888">Loading...</div>';
    const { data } = await supabase.from('contacts').select('*').eq('owner', currentUser.id);
    myContacts = data || [];
    renderContacts();
}

function renderContacts(filter = '') {
    const list = get('contactsList');
    if (!list) return;
    list.innerHTML = '';
    
    const filtered = myContacts.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) || c.phone.includes(filter));
    if (filtered.length === 0) { list.innerHTML = '<div style="padding:20px;text-align:center;color:#888">No contacts.</div>'; return; }

    filtered.forEach(c => {
        const div = document.createElement('div');
        div.className = 'contact';
        div.innerHTML = `<div class="avatar">${c.name[0].toUpperCase()}</div><div><div style="font-weight:bold;color:#e9edef;">${escapeHtml(c.name)}</div><div style="font-size:12px;color:#8696a0;">${escapeHtml(c.phone)}</div></div>`;
        div.onclick = () => openChat(c);
        list.appendChild(div);
    });
}

async function saveNewContact() {
    const phone = getVal('addContactPhone');
    const name = getVal('addContactName');
    if (!phone) return alert('Phone number required');

    const { data: user } = await supabase.from('profiles').select('*').eq('phone', phone).maybeSingle();
    const newContact = { owner: currentUser.id, phone, name: name || (user ? user.username : phone), contact_user: user ? user.id : null };

    await supabase.from('contacts').insert([newContact]);
    hide(get('modalAddContact'));
    loadContacts();
    if (!user) alert('Contact added! They must register to chat.');
}

// --- CHAT ---
async function openChat(contact) {
    if (!contact.contact_user) return alert('This contact has not registered yet.');
    activeContact = contact;
    setText('chatTitle', contact.name);
    setText('chatSubtitle', contact.phone);
    setText('chatAvatar', contact.name[0].toUpperCase());
    
    if (window.innerWidth < 900) get('chatPanel').classList.add('active-screen');
    loadMessages();
}

async function loadMessages() {
    const container = get('messages');
    container.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">Loading...</div>';
    const convId = convIdFor(currentUser.id, activeContact.contact_user);
    
    // Ensure conversation exists
    const { error: upsertError } = await supabase.from('conversations').upsert({ id: convId });
    if(upsertError) console.warn("Conversation init error (ignore if duplicate):", upsertError);

    // Load existing
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at');
    
    container.innerHTML = '';
    if (data && data.length > 0) {
        for (const m of data) {
            await renderMessage(m);
        }
    } else {
        container.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">No messages yet</div>';
    }

    // SUBSCRIBE (Fixed)
    if (messageSub) messageSub.unsubscribe();
    
    // Listen to ALL messages for this conversation
    messageSub = supabase.channel('chat:' + convId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` }, payload => {
            // We check if the message ID is already in DOM to avoid duplicates from our own optimistic render
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

    const payload = { 
        conversation_id: convId, 
        from_user: currentUser.id, 
        text, 
        attachments: attachments.length ? JSON.stringify(attachments) : null 
    };
    
    // 1. OPTIMISTIC RENDER (Show immediately)
    const tempId = `temp-${Date.now()}`;
    renderMessage({ ...payload, created_at: new Date().toISOString(), id: tempId });

    // 2. Send to DB
    const { data, error } = await supabase.from('messages').insert([payload]).select();
    
    if (error) {
        alert('Message failed: ' + error.message);
        // Optional: remove temp message or show error state
    } else if (data && data[0]) {
        // Update ID of optimistic message
        const tempEl = document.getElementById(`msg-${tempId}`);
        if (tempEl) tempEl.id = `msg-${data[0].id}`;
    }
    
    // 3. Push Notification (Graceful Fail)
    try {
        sendPush(activeContact.contact_user, 'New Message', text || 'Sent a file');
    } catch(e) { console.warn('Push skipped:', e); }
}

function renderMessage(msg) {
    const container = get('messages');
    if(container.innerHTML.includes('No messages yet') || container.innerHTML.includes('Loading...')) container.innerHTML = '';

    const div = document.createElement('div');
    div.id = `msg-${msg.id}`; // Add ID for duplicate checking
    div.className = `msg ${msg.from_user === currentUser.id ? 'me' : 'them'}`;
    let content = `<div>${escapeHtml(msg.text)}</div>`;

    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = content + `<div class="time">${time}</div>`;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    // Async load images
    if (msg.attachments) {
        try {
            const atts = JSON.parse(msg.attachments);
            const attDiv = document.createElement('div');
            attDiv.className = 'att';
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

// --- CALLING ---
/* ========== CALLING (ROBUST) ==========
   Replaced the previous fragile call block with robust signaling + UI helpers.
   This uses the same DB schema (table `calls`) and same column names.
*/

async function startCallAction(video) {
    if (!activeContact?.contact_user) return alert('User not registered');
    const remoteId = activeContact.contact_user;
    currentCallId = `call_${Date.now()}`;

    // create RTCPeerConnection
    pc = new RTCPeerConnection({ iceServers: STUN });

    // create a small preview video in chat avatar (same as before)
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: !!video, audio: true });
        const v = document.createElement('video');
        v.autoplay = true; v.muted = true;
        v.playsInline = true;
        v.srcObject = localStream;
        v.style.width = '40px'; v.style.height = '40px'; v.style.objectFit = 'cover';
        // clear previous avatar content and attach preview
        if (get('chatAvatar')) {
            get('chatAvatar').innerHTML = '';
            get('chatAvatar').appendChild(v);
        }
        // add local tracks to peer connection
        for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    } catch (err) {
        return alert('Camera / mic permission error: ' + (err.message || err));
    }

    // send ICE candidates to DB (as JSON)
    pc.onicecandidate = async (e) => {
        if (!e.candidate) return;
        const payload = JSON.stringify(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
        try {
            await supabase.from('calls').insert([{
                call_id: currentCallId,
                from_user: currentUser.id,
                to_user: remoteId,
                type: 'ice',
                payload
            }]);
        } catch (err) {
            console.warn('Failed to send ICE to server:', err);
        }
    };

    // when remote tracks arrive, show them
    pc.ontrack = (e) => {
        // Prefer the first stream
        const s = e.streams && e.streams[0] ? e.streams[0] : null;
        showRemoteVideo(s);
    };

    // create offer
    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // store offer as JSON string to avoid type mismatches later
        await supabase.from('calls').insert([{
            call_id: currentCallId,
            from_user: currentUser.id,
            to_user: remoteId,
            type: 'offer',
            payload: JSON.stringify(offer)
        }]);

        // notify remote user (push)
        try { sendPush(remoteId, 'Incoming Call', `Call from ${myProfile?.username || 'Unknown'}`); } catch(e){}

        // show caller UI and listen for call events
        showOutgoingCallingUI(currentCallId, remoteId);
        enhancedListenToCallEvents(currentCallId);
    } catch (err) {
        alert('Failed to start call: ' + (err.message || err));
        cleanupCallResources();
    }
}

function enhancedListenToCallEvents(callId) {
    // clean up previous channel if any
    if (callsChannel) {
        try { callsChannel.unsubscribe(); } catch(e) {}
        callsChannel = null;
    }

    // subscribe to rows for this call_id
    callsChannel = supabase.channel('call_' + callId)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'calls', filter: `call_id=eq.${callId}` },
            async ({ new: row }) => {
                if (!row) return;
                // If this insert came from me, only handle certain types
                if (row.from_user === currentUser.id) {
                    if (row.type === 'reject' || row.type === 'cancel') {
                        removeOutgoingCallingUI();
                        cleanupCallResources();
                    }
                    return;
                }

                // incoming events for the caller/receiver
                if (row.type === 'offer') {
                    // Receiver will handle offers via global subscription popup flow,
                    // but if we get an offer for an active call ID we show popup:
                    showIncomingCallPopup(row);
                    return;
                }

                if (row.type === 'cancel') {
                    removeIncomingModal();
                    stopRinging();
                    return;
                }

                if (row.type === 'reject') {
                    removeOutgoingCallingUI();
                    cleanupCallResources();
                    return;
                }

                // normalize payload (it may be a stringified JSON or native object)
                let payload = row.payload;
                if (typeof payload === 'string') {
                    try { payload = JSON.parse(payload); } catch(e) { /* keep original */ }
                }

                try {
                    if (row.type === 'answer' && pc) {
                        // set remote description from answer
                        const desc = { type: payload.type, sdp: payload.sdp };
                        await pc.setRemoteDescription(new RTCSessionDescription(desc));
                        removeOutgoingCallingUI();
                        stopRinging();
                    } else if (row.type === 'ice' && pc) {
                        // add ICE candidate
                        const candidate = payload.candidate || payload; // candidate shape may vary
                        await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                } catch (e) {
                    console.warn('Error handling call signal:', e);
                }
            }).subscribe();
}

function subscribeToGlobalEvents() {
    if (globalSub) {
        try { globalSub.unsubscribe(); } catch(e) {}
        globalSub = null;
    }

    globalSub = supabase.channel('user_global_' + currentUser.id)
        // incoming offers for this user
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'calls', filter: `to_user=eq.${currentUser.id}` },
            async ({ new: row }) => {
                if (!row) return;
                // Normalize payload and only react to offers
                if (row.type && row.type === 'offer') {
                    // show incoming popup to accept/decline (do not auto-accept)
                    showIncomingCallPopup(row);
                } else if (row.type && row.type === 'ice') {
                    // if we have a PC active and this ICE is for the active call, add candidate
                    const payload = (typeof row.payload === 'string') ? JSON.parse(row.payload) : row.payload;
                    if (pc && row.call_id === currentCallId && payload) {
                        try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate || payload)); } catch(e) {}
                    }
                }
            })
        // also keep earlier message behavior (notifications)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
            if (payload.new.from_user !== currentUser.id) {
                if (!activeContact || activeContact.contact_user !== payload.new.from_user) {
                    showToast('New Message Received!');
                    playTone('receive');
                }
            }
        }).subscribe();
}

async function handleIncomingCall(row) {
    // row is the DB row containing the offer
    playTone('receive');

    // set current call
    currentCallId = row.call_id;

    // Ensure existing call channel is attached to this call (so we can receive ICE from caller)
    enhancedListenToCallEvents(currentCallId);

    // create RTCPeerConnection
    pc = new RTCPeerConnection({ iceServers: STUN });

    // get local media - if incoming offer had video hint we try to get both; otherwise audio-only
    let offerPayload = row.payload;
    if (typeof offerPayload === 'string') {
        try { offerPayload = JSON.parse(offerPayload); } catch(e) {}
    }

    // determine if the offer likely contains SDP with "m=video" -> attempt video; else audio only
    const wantsVideo = offerPayload && offerPayload.sdp && offerPayload.sdp.includes('m=video');

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: wantsVideo, audio: true });
        for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
    } catch (err) {
        alert('Could not access camera/mic: ' + (err.message || err));
        return;
    }

    // attach remote video element early so ontrack has target
    showRemoteVideo(null);

    pc.ontrack = (e) => {
        const stream = e.streams && e.streams[0] ? e.streams[0] : null;
        const remoteEl = document.getElementById('remoteVideo');
        if (remoteEl && stream) remoteEl.srcObject = stream;
    };

    pc.onicecandidate = async (e) => {
        if (!e.candidate) return;
        const payload = JSON.stringify(e.candidate.toJSON ? e.candidate.toJSON() : e.candidate);
        // reply back to caller (to_user = original from_user)
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
        // set remote description (the offer)
        const offerDesc = (typeof offerPayload === 'object') ? offerPayload : JSON.parse(String(row.payload));
        await pc.setRemoteDescription(new RTCSessionDescription({ type: offerDesc.type, sdp: offerDesc.sdp }));

        // create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // send answer back (stringified)
        await supabase.from('calls').insert([{
            call_id: currentCallId,
            from_user: currentUser.id,
            to_user: row.from_user,
            type: 'answer',
            payload: JSON.stringify(answer)
        }]);

        // start listening for ICE/answer events for this call (already done above)
        enhancedListenToCallEvents(currentCallId);
    } catch (err) {
        alert('Call setup failed: ' + (err.message || err));
        cleanupCallResources();
    }
}

function showRemoteVideo(stream) {
    // Remove existing remote video if present
    const existing = document.getElementById('remoteVideo');
    if (existing) existing.remove();

    // create a full-screen remote video
    const v = document.createElement('video');
    v.id = 'remoteVideo';
    v.autoplay = true;
    v.playsInline = true;
    v.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:black;object-fit:contain;";
    if (stream) v.srcObject = stream;
    document.body.appendChild(v);

    // add an End Call button if not present
    let btn = document.getElementById('endCallBtn');
    if (btn) btn.remove();
    btn = document.createElement('button');
    btn.id = 'endCallBtn';
    btn.innerText = "End Call";
    btn.style.cssText = "position:fixed;bottom:50px;left:50%;transform:translateX(-50%);z-index:10000;padding:15px 30px;background:red;color:white;border:none;border-radius:30px;font-weight:bold;";
    btn.onclick = () => { endCall(); };
    document.body.appendChild(btn);
}

function cleanupCallResources() {
    try { if (pc) pc.close(); } catch(e) {}
    pc = null;
    try { if (localStream) localStream.getTracks().forEach(t => t.stop()); } catch(e) {}
    localStream = null;
    try { if (callsChannel) callsChannel.unsubscribe(); } catch(e) {}
    callsChannel = null;
    currentCallId = null;
    // remove remote video and end button
    const rv = document.getElementById('remoteVideo'); if (rv) rv.remove();
    const btn = document.getElementById('endCallBtn'); if (btn) btn.remove();
    // remove any call UI overlays
    const out = document.getElementById('outgoingCallUI'); if (out) out.remove();
    const inc = document.getElementById('incomingCallModal'); if (inc) inc.remove();
    stopRinging();
}

function endCall() {
    cleanupCallResources();
    // restore chat avatar (simple placeholder)
    if (get('chatAvatar')) get('chatAvatar').textContent = (myProfile?.username || 'U')[0] || 'U';
}


// --- INCOMING / OUTGOING CALL UI + RINGTONE HELPERS ---

let ringtone = null;
function ensureRingtone() {
  if (ringtone) return;
  ringtone = document.createElement('audio');
  // A short ringtone URL; you can replace with your asset or base64. It's fine to keep remote link.
  ringtone.src = 'https://actions.google.com/sounds/v1/alarms/phone_ringing.ogg';
  ringtone.loop = true;
  ringtone.volume = 0.8;
  ringtone.id = 'app_ringtone';
  document.body.appendChild(ringtone);
}

function stopRinging() {
  if (ringtone) {
    try { ringtone.pause(); ringtone.currentTime = 0; } catch (e) {}
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    try { audioCtx.resume(); } catch(e) {}
  }
}

function removeIncomingModal() {
  const m = document.getElementById('incomingCallModal');
  if (m) m.remove();
}

function removeOutgoingCallingUI() {
  const el = document.getElementById('outgoingCallUI');
  if (el) el.remove();
  stopRinging();
}

function showIncomingCallPopup(callRow) {
  // don't show duplicate modal
  if (document.getElementById('incomingCallModal')) return;

  ensureRingtone();
  try { ringtone.play().catch(()=>{}); } catch(e){}

  const caller = callRow.from_user || 'Unknown';

  const modal = document.createElement('div');
  modal.id = 'incomingCallModal';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:20000;';

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);';
  modal.appendChild(backdrop);

  const card = document.createElement('div');
  card.style.cssText = 'position:relative;min-width:320px;padding:18px;border-radius:12px;background:#111;color:#fff;display:flex;flex-direction:column;align-items:center;gap:12px;z-index:20001;box-shadow:0 10px 30px rgba(0,0,0,0.6);';
  modal.appendChild(card);

  const title = document.createElement('div');
  title.innerText = 'Incoming Call';
  title.style.fontSize = '18px'; title.style.fontWeight = '700';
  card.appendChild(title);

  const who = document.createElement('div');
  who.innerText = `From: ${caller}`;
  who.style.opacity = '0.9';
  card.appendChild(who);

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:12px;margin-top:6px;';
  const accept = document.createElement('button');
  accept.innerText = 'Accept';
  accept.style.cssText = 'padding:10px 16px;border-radius:8px;background:green;color:white;border:none;font-weight:600;';
  const decline = document.createElement('button');
  decline.innerText = 'Decline';
  decline.style.cssText = 'padding:10px 16px;border-radius:8px;background:#333;color:white;border:none;font-weight:600;';

  btns.appendChild(accept); btns.appendChild(decline);
  card.appendChild(btns);

  document.body.appendChild(modal);

  accept.onclick = async () => {
    stopRinging();
    removeIncomingModal();
    // Accept: run incoming handler
    try {
      await handleIncomingCall(callRow);
    } catch (err) {
      console.warn('Accept handler error:', err);
    }
  };

  decline.onclick = async () => {
    stopRinging();
    removeIncomingModal();
    try {
      await supabase.from('calls').insert([{
        call_id: callRow.call_id,
        from_user: currentUser.id,
        to_user: callRow.from_user,
        type: 'reject',
        payload: JSON.stringify({ reason: 'declined' })
      }]);
    } catch (err) { console.warn('Failed sending reject:', err); }
  };
}

function showOutgoingCallingUI(callId, calleeId) {
  if (document.getElementById('outgoingCallUI')) return;
  ensureRingtone();
  try { ringtone.play().catch(()=>{}); } catch(e){}

  const container = document.createElement('div');
  container.id = 'outgoingCallUI';
  container.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);z-index:20000;background:#0d0d0d;color:#fff;padding:12px 16px;border-radius:20px;display:flex;align-items:center;gap:12px;box-shadow:0 6px 20px rgba(0,0,0,0.5);';
  container.innerHTML = `<div style="font-weight:600">Calling ${calleeId}...</div>`;

  const cancel = document.createElement('button');
  cancel.innerText = 'Cancel';
  cancel.style.cssText = 'padding:8px 12px;border-radius:12px;background:#333;color:#fff;border:none;font-weight:600;';
  cancel.onclick = async () => {
    stopRinging();
    const el = document.getElementById('outgoingCallUI'); if (el) el.remove();
    try {
      await supabase.from('calls').insert([{
        call_id: callId,
        from_user: currentUser.id,
        to_user: calleeId,
        type: 'cancel',
        payload: JSON.stringify({ reason: 'caller_cancelled' })
      }]);
    } catch (err) { console.warn('Failed to send cancel:', err); }
    cleanupCallResources();
  };

  container.appendChild(cancel);
  document.body.appendChild(container);
}

// ---------------------- UTILS & HELPERS ----------------------
async function getSignedUrl(bucket, path) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl;
}

function playTone(type) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (!audioCtx) return BEEP_SOUND.play().catch(() => {});
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(audioCtx.destination);
    if (type === 'send') osc.frequency.value = 800; else osc.frequency.value = 600;
    g.gain.value = 0.1;
    osc.start(); setTimeout(() => osc.stop(), 150);
}

async function sendPush(uid, title, body) {
    // Guard against localhost (to prevent 405 errors in dev)
    if(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;
    
    // Use explicit fetch without awaiting to prevent UI blocking
    fetch('/api/send-push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toUserId: uid, title, message: body }) })
    .then(res => {
        if(!res.ok) console.warn('Push API returned ' + res.status);
    })
    .catch(e => console.warn('Push failed:', e));
}

function showToast(msg) {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#00a884;color:#fff;padding:10px 20px;border-radius:20px;z-index:99999;box-shadow:0 2px 10px rgba(0,0,0,0.3);";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3000);
}

function handleAvatarSelect(e) { if (e.target.files[0]) get('avatarPreview').innerHTML = '📸'; }
function openProfileScreen() { 
    if(myProfile) {
        get('profileName').value = myProfile.username || ''; 
        get('profilePhone').value = myProfile.phone || ''; 
    }
    showScreen('profile'); 
}
function closeChatPanel() { if (get('chatPanel')) get('chatPanel').classList.remove('active-screen'); activeContact = null; }
function renderFilePreview(files) { if (files.length) get('filePreview').innerHTML = `📄 ${files[0].name}`; }

function showMyQr() { 
    const ph = myProfile?.phone || get('profilePhone').value; 
    if (!ph) return alert('No phone set. Save profile first.'); 
    get('qrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(ph)}`; 
    show(get('modalQr')); 
}

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
function handleScannedText(txt) {
    if (!txt) return;
    if (txt.includes('addPhone=')) get('addContactPhone').value = new URL(txt).searchParams.get('addPhone');
    else get('addContactPhone').value = txt;
    saveNewContact();
}
function handleUrlParams() {
    const params = new URLSearchParams(location.search);
    const addPhone = params.get('addPhone');
    if (addPhone) { show(get('modalAddContact')); get('addContactPhone').value = addPhone; window.history.replaceState({}, document.title, "/"); }
}

async function registerPush() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js');
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY) });
            await supabase.from('push_subscriptions').upsert({ user_id: currentUser.id, endpoint: sub.endpoint, p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))) }, { onConflict: 'endpoint' });
        } catch (e) {}
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

// Expose some functions to window so existing HTML can call them unchanged
window.startCallAction = startCallAction;
window.endCall = endCall;
window.subscribeToGlobalEvents = subscribeToGlobalEvents;
window.cleanupCallResources = cleanupCallResources;

console.log('app.js loaded — calling system updated (popup + robust signaling).');
