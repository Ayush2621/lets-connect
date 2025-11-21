// app.js — FINAL FIXED VERSION (Supabase v2 Compatibility Fixes)
'use strict';

// --- 1. GLOBAL SETUP ---
const supabase = window.supabase;
if (!supabase) {
    alert('CRITICAL ERROR: Supabase client not found. Check index.html.');
    throw new Error('Supabase missing');
}

// Reliable Base64 Beep
const BEEP_SOUND = new Audio("data:audio/mp3;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgRYWFgAAAAwAAADbWlub3JfdmVyc2lvbgAwAFRYWFgAAAAkAAADY29tcGF0aWJsZV9icmFuZHMAbXA0Mmlzb21tcDQx//uQZAAAAAAA0AAAAABAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcYAAAAAAABAAAIMwAAAAAS"); 

// State
let currentUser = null;
let myProfile = null;
let activeContact = null;
let myContacts = [];
let audioCtx = null; 
let presenceInterval = null;

// WebRTC
let pc = null;
let localStream = null;
let callsChannel = null;
let globalSub = null;
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
    
    // FIX 1: Removed .catch() - Supabase v2 returns { error } object, no catch needed on builder
    const { error: upsertError } = await supabase.from('conversations').upsert({ id: convId });
    if(upsertError) console.warn("Conversation init error (ignore if duplicate):", upsertError);

    const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at');
    
    container.innerHTML = '';
    if (data && data.length > 0) {
        for (const m of data) {
            await renderMessage(m);
        }
    } else {
        container.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">No messages yet</div>';
    }

    if (messageSub) messageSub.unsubscribe();
    messageSub = supabase.channel('chat:' + convId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            if(payload.new.conversation_id === convId) {
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
    
    const { error } = await supabase.from('messages').insert([payload]);
    if (error) alert('Message failed: ' + error.message);
    
    sendPush(activeContact.contact_user, 'New Message', text || 'Sent a file');
}

function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = `msg ${msg.from_user === currentUser.id ? 'me' : 'them'}`;
    let content = `<div>${escapeHtml(msg.text)}</div>`;

    // Append immediately
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = content + `<div class="time">${time}</div>`;
    
    const container = get('messages');
    if(container.innerHTML.includes('No messages yet')) container.innerHTML = '';
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
async function startCallAction(video) {
    if (!activeContact?.contact_user) return alert('User not registered');
    const remoteId = activeContact.contact_user;
    currentCallId = `call_${Date.now()}`;
    
    pc = new RTCPeerConnection({ iceServers: STUN });
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
        const v = document.createElement('video');
        v.srcObject = localStream; v.autoplay = true; v.muted = true; v.style.width='40px'; v.style.height='40px'; v.style.objectFit='cover';
        get('chatAvatar').innerHTML = ''; 
        get('chatAvatar').appendChild(v);
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    } catch(e) { return alert('Camera error: ' + e.message); }

    pc.onicecandidate = async (e) => {
        if (e.candidate) await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: remoteId, type: 'ice', payload: e.candidate }]);
    };
    pc.ontrack = (e) => showRemoteVideo(e.streams[0]);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: remoteId, type: 'offer', payload: offer }]);
    
    sendPush(remoteId, 'Incoming Call', `Call from ${myProfile.username}`);
    listenToCallEvents(currentCallId);
}

function listenToCallEvents(callId) {
    if (callsChannel) callsChannel.unsubscribe();
    callsChannel = supabase.channel('call_' + callId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `call_id=eq.${callId}` }, async (payload) => {
            const row = payload.new;
            if (row.from_user === currentUser.id) return;
            if (row.type === 'answer') await pc.setRemoteDescription(row.payload);
            else if (row.type === 'ice') await pc.addIceCandidate(row.payload);
        }).subscribe();
}

function subscribeToGlobalEvents() {
    if (globalSub) globalSub.unsubscribe();
    globalSub = supabase.channel('user_global_' + currentUser.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `to_user=eq.${currentUser.id}` }, async (payload) => {
            if (payload.new.type === 'offer') handleIncomingCall(payload.new);
        })
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
    playTone('receive');
    if (!confirm('Incoming Call... Answer?')) return;
    currentCallId = row.call_id;
    pc = new RTCPeerConnection({ iceServers: STUN });
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
        showRemoteVideo(null);
        pc.ontrack = (e) => { get('remoteVideo').srcObject = e.streams[0]; };
        pc.onicecandidate = async (e) => {
            if (e.candidate) await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: row.from_user, type: 'ice', payload: e.candidate }]);
        };
        await pc.setRemoteDescription(row.payload);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: row.from_user, type: 'answer', payload: answer }]);
        listenToCallEvents(currentCallId);
    } catch (e) { alert('Call failed: ' + e.message); }
}

function showRemoteVideo(stream) {
    const v = document.createElement('video');
    v.id = 'remoteVideo'; v.autoplay = true; v.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:black;";
    if (stream) v.srcObject = stream;
    document.body.appendChild(v);
    const btn = document.createElement('button');
    btn.innerText = "End Call";
    btn.style.cssText = "position:fixed;bottom:50px;left:50%;transform:translateX(-50%);z-index:10000;padding:15px 30px;background:red;color:white;border:none;border-radius:30px;font-weight:bold;";
    btn.onclick = () => { v.remove(); btn.remove(); endCall(); };
    document.body.appendChild(btn);
}

function endCall() {
    if (pc) pc.close(); pc = null;
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (callsChannel) callsChannel.unsubscribe();
    window.location.reload();
}

// --- UTILS & HELPERS ---
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
    fetch('/api/send-push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toUserId: uid, title, message: body }) }).catch(() => {});
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
    // Fix: Use profile from memory
    if(myProfile) {
        get('profileName').value = myProfile.username || ''; 
        get('profilePhone').value = myProfile.phone || ''; 
    }
    showScreen('profile'); 
}
function closeChatPanel() { if (get('chatPanel')) get('chatPanel').classList.remove('active-screen'); activeContact = null; }
function renderFilePreview(files) { if (files.length) get('filePreview').innerHTML = `📄 ${files[0].name}`; }

// FIX: QR Logic
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

// FIX 2: Removed .catch() here as well
function startPresence() {
    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(() => {
        if (!currentUser) return;
        supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', currentUser.id).then(({ error }) => {
            if (error) console.warn('Presence update failed:', error);
        });
    }, 15000);
}