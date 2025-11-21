// app.js — Final Fixes: Event Listener Placement, Call Logic, and QR Generation
'use strict';

const supabase = window.supabase;
if (!supabase) throw new Error('Supabase client missing (check index.html)');

// Reliable "Ding" Sound
const NOTIFICATION_SOUND = new Audio("data:audio/mp3;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgRYWFgAAAAwAAADbWlub3JfdmVyc2lvbgAwAFRYWFgAAAAkAAADY29tcGF0aWJsZV9icmFuZHMAbXA0Mmlzb21tcDQx//uQZAAAAAAA0AAAAABAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcYAAAAAAABAAAIMwAAAAAS"); 

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- DOM refs ---------- */
  const authSection = document.getElementById('authSection');
  const profileSection = document.getElementById('profileSection');
  const appSection = document.getElementById('appSection');

  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const formSignIn = document.getElementById('formSignIn');
  const formSignUp = document.getElementById('formSignUp');
  const signinEmail = document.getElementById('signinEmail');
  const signinPass = document.getElementById('signinPass');
  const signupEmail = document.getElementById('signupEmail');
  const signupPass = document.getElementById('signupPass');
  const btnSignIn = document.getElementById('btnSignIn');
  const btnSignUp = document.getElementById('btnSignUp');
  const btnDemo = document.getElementById('btnDemo');

  const profileAvatar = document.getElementById('profileAvatar');
  const avatarPreview = document.getElementById('avatarPreview');
  const profileName = document.getElementById('profileName');
  const profilePhone = document.getElementById('profilePhone');
  const profilePhoneDisplay = document.getElementById('profilePhoneDisplay');
  const btnSaveProfile = document.getElementById('btnSaveProfile');
  const btnSkipProfile = document.getElementById('btnSkipProfile');
  const btnShowQr = document.getElementById('btnShowQr');
  const btnScanQr = document.getElementById('btnScanQr');

  const meAvatar = document.getElementById('meAvatar');
  const meName = document.getElementById('meName');
  const mePhone = document.getElementById('mePhone');
  const btnOpenProfile = document.getElementById('btnOpenProfile');

  const contactSearch = document.getElementById('contactSearch');
  const btnAddContactMain = document.getElementById('btnAddContactMain');
  const btnRefresh = document.getElementById('btnRefresh');
  const contactsList = document.getElementById('contactsList');
  
  const chatPanel = document.getElementById('chatPanel'); 
  const btnBackMobile = document.getElementById('btnBackMobile');

  const chatAvatar = document.getElementById('chatAvatar');
  const chatTitle = document.getElementById('chatTitle');
  const chatSubtitle = document.getElementById('chatSubtitle');
  const messages = document.getElementById('messages');
  const inputMessage = document.getElementById('inputMessage');
  const btnSendMain = document.getElementById('btnSendMain');
  const btnAttachMain = document.getElementById('btnAttachMain');
  const attachFile = document.getElementById('attachFile');
  const filePreview = document.getElementById('filePreview');
  const btnEmoji = document.getElementById('btnEmoji');
  const btnVoiceCall = document.getElementById('btnVoiceCall');
  const btnVideoCall = document.getElementById('btnVideoCall');
  const btnClearChat = document.getElementById('btnClearChat');

  const modalAddContact = document.getElementById('modalAddContact');
  const addContactName = document.getElementById('addContactName');
  const addContactPhone = document.getElementById('addContactPhone');
  const addContactSave = document.getElementById('addContactSave');
  const addContactCancel = document.getElementById('addContactCancel');
  const btnFindByPhone = document.getElementById('btnFindByPhone');

  const modalQr = document.getElementById('modalQr');
  const qrImage = document.getElementById('qrImage');
  const qrClose = document.getElementById('qrClose');
  const modalQrScan = document.getElementById('modalQrScan');
  const qrVideo = document.getElementById('qrVideo');
  const qrScanClose = document.getElementById('qrScanClose');

  /* ---------- state ---------- */
  let currentUser = null;
  let myProfile = null;
  let myContacts = [];
  let activeContact = null;
  let messageSub = null;
  let globalSub = null;
  let presenceInterval = null;

  // WebRTC
  let pc = null;
  let localStream = null;
  let callsChannel = null;
  let currentCallId = null;
  let scannerStream = null;

  const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

  /* ---------- helpers ---------- */
  function show(el) { if (!el) return; el.classList.remove('hidden'); el.style.display=''; }
  function hide(el) { if (!el) return; el.classList.add('hidden'); el.style.display='none'; }
  function showOnly(key) { 
      [authSection, profileSection, appSection].forEach(hide);
      if (key === 'auth') show(authSection);
      if (key === 'profile') show(profileSection);
      if (key === 'app') show(appSection);
  }
  function convIdFor(a,b){ return [a,b].sort().join('_'); }
  function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  
  /* ---------- AUDIO SOUNDS ---------- */
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  function playSound(type) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    if (type === 'sent') {
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.stop(t + 0.1);
    } else if (type === 'received') {
        osc.frequency.setValueAtTime(800, t);
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.stop(t + 0.5);
    } else if (type === 'ring') {
        osc.frequency.setValueAtTime(440, t);
        osc.type = 'triangle';
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.2, t + 0.1);
        gain.gain.linearRampToValueAtTime(0, t + 1.5);
        osc.stop(t + 1.5);
    }
    osc.connect(gain); gain.connect(audioCtx.destination); osc.start(t);
  }

  /* ---------- SECURE IMAGE HELPER ---------- */
  async function getSecureUrl(bucket, path) {
      if (!path) return null;
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      if (error) { console.warn('Signed URL Error:', error.message); return null; }
      return data.signedUrl;
  }

  /* ---------- INITIALIZE LISTENERS (MOVED OUTSIDE BOOT) ---------- */
  // Auth
  btnSignUp.onclick = async()=> {
    if (authBusy) return; authBusy=true; 
    const t=btnSignUp.textContent; btnSignUp.textContent='Creating...'; btnSignUp.disabled=true;
    const email = (signupEmail.value||'').trim(), password = (signupPass.value||'').trim();
    if (!email || password.length < 6) { alert('Enter valid email & password'); authBusy=false; btnSignUp.textContent=t; btnSignUp.disabled=false; return; }
    
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) { alert(error.message); authBusy=false; btnSignUp.textContent=t; btnSignUp.disabled=false; return; }
    await supabase.auth.signInWithPassword({ email, password }).catch(()=>null);
    await loadSession(); authBusy=false; btnSignUp.textContent=t; btnSignUp.disabled=false;
  };

  btnSignIn.onclick = async()=> {
    if (authBusy) return; authBusy=true; 
    const t=btnSignIn.textContent; btnSignIn.textContent='Logging in...'; btnSignIn.disabled=true;
    const email = (signinEmail.value||'').trim(), password = (signinPass.value||'').trim();
    if (!email || !password) { alert('Enter credentials'); authBusy=false; btnSignIn.textContent=t; btnSignIn.disabled=false; return; }
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { alert(error.message); authBusy=false; btnSignIn.textContent=t; btnSignIn.disabled=false; return; }
    await loadSession(); authBusy=false; btnSignIn.textContent=t; btnSignIn.disabled=false;
  };

  btnDemo.onclick = async()=> {
    if (authBusy) return; authBusy=true; btnDemo.disabled=true;
    const email = `demo${Date.now()%10000}@example.com`, password = 'demopass';
    await supabase.auth.signUp({ email, password }).catch(()=>null);
    await supabase.auth.signInWithPassword({ email, password }).catch(()=>null);
    await loadSession();
  };

  // Profile
  profileAvatar.onchange = (e)=> {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    avatarPreview.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:12px;object-fit:cover" />`;
  };

  btnSaveProfile.onclick = async ()=> {
    try {
      btnSaveProfile.disabled = true; btnSaveProfile.textContent = 'Saving...';
      const name = (profileName.value||'User').trim();
      const phone = (profilePhone.value||'').trim();
      if (!phone) throw new Error('Phone required');
      
      const f = profileAvatar.files && profileAvatar.files[0];
      let avatar_path = myProfile?.avatar_path || null;
      if (f) {
        const path = `avatars/${currentUser.id}/${Date.now()}_${f.name.replace(/[^a-z0-9_\-\.]/gi,'_')}`;
        const up = await supabase.storage.from('avatars').upload(path, f);
        if (up.error) throw up.error;
        avatar_path = path;
      }
      const toUpsert = { id: currentUser.id, username: name, phone, avatar_path, last_seen: new Date().toISOString() };
      await supabase.from('profiles').upsert(toUpsert);
      myProfile = toUpsert;
      showOnly('app'); await bootMain();
      registerServiceWorkerAndSubscribe();
    } catch (err) { alert(err.message); } finally { btnSaveProfile.disabled = false; btnSaveProfile.textContent = 'Next'; }
  };

  btnSkipProfile.onclick = async ()=> {
    const updates = { id: currentUser.id, username: 'User', phone: '', last_seen: new Date().toISOString() };
    await supabase.from('profiles').upsert(updates);
    myProfile = updates;
    showOnly('app'); await bootMain();
    registerServiceWorkerAndSubscribe();
  };

  // Messaging & UI (Moved outside bootMain so they are always active)
  btnSendMain.onclick = sendMessageHandler;
  inputMessage.onkeydown = (e)=> { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessageHandler(); } };
  
  btnAttachMain.onclick = ()=> attachFile.click();
  attachFile.onchange = (e)=> renderFilePreview(e.target.files);
  btnEmoji.onclick = showEmojiPicker;
  btnVoiceCall.onclick = ()=> startCallWithActive(false);
  btnVideoCall.onclick = ()=> startCallWithActive(true);
  btnClearChat.onclick = clearConversation;
  
  if(btnBackMobile) btnBackMobile.onclick = () => { if (chatPanel) chatPanel.classList.remove('active-screen'); };
  btnOpenProfile.onclick = ()=> { profileName.value = myProfile?.username || ''; profilePhone.value = myProfile?.phone || ''; showOnly('profile'); };
  
  btnAddContactMain.onclick = openAddContactModal;
  addContactCancel.onclick = closeAddContactModal;
  addContactSave.onclick = saveAddContact;
  btnFindByPhone.onclick = findUserByPhoneAndAdd;
  btnRefresh.onclick = loadContacts;
  contactSearch.oninput = (e)=> renderContacts(e.target.value);

  // QR Logic (Fixed)
  if (btnShowQr) btnShowQr.onclick = ()=> {
    const ph = myProfile?.phone || profilePhone.value || '';
    if (!ph) return alert('Enter a phone number first.');
    const payload = `${location.origin}/?addPhone=${encodeURIComponent(ph)}`;
    // Using qrserver.com which is more reliable than Google Charts
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(payload)}`;
    show(modalQr);
  };
  if (qrClose) qrClose.onclick = ()=> hide(modalQr);
  if (btnScanQr) btnScanQr.onclick = startQrScan;
  if (qrScanClose) qrScanClose.onclick = ()=> { stopScanner(); hide(modalQrScan); };


  /* ---------- AUTH CHECK ---------- */
  let authBusy = false;
  async function loadSession() {
    try {
      const s = await supabase.auth.getSession();
      currentUser = s?.data?.session?.user || null;
      if (!currentUser) { showOnly('auth'); stopPresence(); return; }

      const { data } = await supabase.from('profiles').select('*').eq('id', currentUser.id).limit(1).maybeSingle();
      if (data) {
        myProfile = data;
        showOnly('app');
        startPresence();
        await bootMain();
      } else {
        profileName.value = currentUser.email ? currentUser.email.split('@')[0] : 'User';
        avatarPreview.textContent = (profileName.value[0]||'U').toUpperCase();
        showOnly('profile');
      }
    } catch (err) { console.error('loadSession err', err); showOnly('auth'); }
  }

  if (!window.__authObserver) {
    window.__authObserver = true;
    supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_IN') loadSession(); });
  }

  /* ---------- BOOT MAIN ---------- */
  async function bootMain() {
    if (!myProfile) return;
    meName.textContent = myProfile.username || currentUser.email;
    mePhone.textContent = myProfile.phone || '—';
    if (profilePhoneDisplay) profilePhoneDisplay.textContent = myProfile.phone || '—';
    
    if (myProfile.avatar_path) {
      const url = await getSecureUrl('avatars', myProfile.avatar_path);
      if (url) meAvatar.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:12px;object-fit:cover" />`;
    }

    await loadContacts();
    subscribeGlobal(); // START LISTENING
    registerServiceWorkerAndSubscribe();
  }

  /* ---------- GLOBAL REALTIME (FIXED CALLING) ---------- */
  function subscribeGlobal() {
      if(globalSub) globalSub.unsubscribe();
      
      // Listen for changes in 'calls' table specifically for current user
      globalSub = supabase.channel('global_user_'+currentUser.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `to_user=eq.${currentUser.id}` }, payload => {
            const row = payload.new;
            console.log("INCOMING SIGNAL:", row); // Debug
            
            // If it is an 'offer', it means someone is calling us
            if(row.type === 'offer') {
                handleOffer(row);
            }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            const row = payload.new;
            // Notify if not current sender
            if (row.from_user !== currentUser.id) {
                const openConvId = activeContact ? convIdFor(currentUser.id, activeContact.contact_user) : null;
                if (openConvId !== row.conversation_id) {
                   playSound('received');
                   showInAppNotification("New Message Received");
                }
            }
        })
        .subscribe((status) => {
            console.log("Global Sub Status:", status);
        });
  }

  function showInAppNotification(text) {
      const div = document.createElement('div');
      div.style.cssText = "position:fixed; top:15px; left:50%; transform:translateX(-50%); background:#00a884; color:#fff; padding:12px 20px; border-radius:24px; z-index:9999; box-shadow:0 4px 15px rgba(0,0,0,0.5); font-weight:500; animation: slideDown 0.3s ease;";
      div.innerHTML = `<span>🔔</span> <span>${text}</span>`;
      document.body.appendChild(div);
      setTimeout(()=> div.remove(), 3000);
  }

  /* ---------- CONTACTS ---------- */
  async function loadContacts() {
    try {
      const { data } = await supabase.from('contacts').select('*').eq('owner', currentUser.id).order('created_at', { ascending: true });
      myContacts = data || [];
      renderContacts();
    } catch (err) { console.warn(err); }
  }

  function renderContacts(filter='') {
    contactsList.innerHTML = '';
    if (!myContacts.length) { contactsList.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">No contacts. Click + to add.</div>'; return; }
    const q = (filter||'').trim().toLowerCase();
    for (const c of myContacts) {
      const name = c.name || (c.contact_user || c.phone || 'Contact');
      if (q && !(name.toLowerCase().includes(q) || (c.phone||'').includes(q))) continue;
      const node = document.createElement('div'); node.className = 'contact' + (activeContact && activeContact.id === c.id ? ' active' : '');
      node.innerHTML = `<div class="avatar">${(name[0]||'C').toUpperCase()}</div>
        <div style="flex:1"><div style="font-weight:600;color:#e9edef">${escapeHtml(name)}</div><div class="muted small">${escapeHtml(c.phone || (c.contact_user || ''))}</div></div>`;
      node.onclick = ()=> selectContact(c);
      contactsList.appendChild(node);
    }
  }

  function openAddContactModal(){ addContactName.value=''; addContactPhone.value=''; modalAddContact.classList.remove('hidden'); }
  function closeAddContactModal(){ modalAddContact.classList.add('hidden'); }

  async function findUserByPhoneAndAdd(){
    const phone = (addContactPhone.value || '').trim();
    if (!phone) return alert('Enter phone number.');
    try {
      const { data } = await supabase.from('profiles').select('*').eq('phone', phone).maybeSingle();
      const contact = { owner: currentUser.id, contact_user: data ? data.id : null, name: addContactName.value || (data ? data.username : phone), phone: data ? data.phone : phone };
      await supabase.from('contacts').insert([contact]);
      closeAddContactModal(); await loadContacts();
    } catch (err) { alert('Search failed: ' + err.message); }
  }
  async function saveAddContact(){ await findUserByPhoneAndAdd(); }

  /* ---------- CHAT ---------- */
  async function selectContact(contact) {
    if (!contact.contact_user) return alert('Contact is not a registered user.');
    activeContact = contact;
    chatTitle.textContent = contact.name || 'Contact';
    chatSubtitle.textContent = contact.phone || '';
    chatAvatar.textContent = (contact.name && contact.name[0]) ? contact.name[0].toUpperCase() : 'U';
    
    if (window.innerWidth < 900 && chatPanel) chatPanel.classList.add('active-screen');
    messages.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">Loading...</div>';

    const conv = convIdFor(currentUser.id, contact.contact_user);
    try {
      const { data } = await supabase.from('conversations').select('*').eq('id', conv).maybeSingle();
      if (!data) await supabase.from('conversations').insert([{ id: conv }]);
      const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', conv).order('created_at', { ascending: true }).limit(500);
      messages.innerHTML = '';
      if (msgs && msgs.length) for (const m of msgs) await renderMessageRow(m); 
      else messages.innerHTML = '<div class="muted small" style="padding:20px;text-align:center">No messages yet</div>';
      
      if (messageSub) messageSub.unsubscribe();
      messageSub = supabase.channel('messages_'+conv).on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`conversation_id=eq.${conv}` }, payload => {
        if (payload.new.from_user !== currentUser.id) playSound('received');
        renderMessageRow(payload.new);
      }).subscribe();
    } catch (err) { console.error(err); }
  }

  async function renderMessageRow(m) {
    if (!m) return;
    const me = (m.from_user === currentUser.id);
    const el = document.createElement('div'); el.className = 'msg ' + (me ? 'me' : '');
    let html = '';
    if (m.text) html += `<div>${escapeHtml(m.text)}</div>`;
    if (m.attachments) {
       try {
         const atts = JSON.parse(m.attachments);
         html += `<div class="att">`;
         for (const a of atts) {
           const url = await getSecureUrl(a.bucket, a.path);
           if (a.type && a.type.startsWith('image/')) html += url ? `<img class="file-thumb" src="${url}" style="max-width:200px; border-radius:8px; margin-top:5px;" />` : `[img]`;
           else if (a.type && a.type.startsWith('video/')) html += url ? `<video controls class="file-thumb" src="${url}" style="max-width:200px; border-radius:8px; margin-top:5px;"></video>` : `[vid]`;
           else html += url ? `<div class="doc-thumb">📄 <a href="${url}" download="${a.name}" target="_blank">${a.name}</a></div>` : `[file]`;
         }
         html += `</div>`;
       } catch(e){ console.error('Att render err', e); }
    }
    html += `<div class="time">${new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>`;
    el.innerHTML = html; messages.appendChild(el); messages.scrollTop = messages.scrollHeight;
  }

  function renderFilePreview(files) {
      filePreview.innerHTML = '';
      if(!files || !files.length) return;
      for(const f of files){
          const d = document.createElement('div'); d.className='file-item';
          d.textContent = '📄 ' + f.name;
          filePreview.appendChild(d);
      }
  }

  async function sendMessageHandler() {
    if (!activeContact || !activeContact.contact_user) return;
    playSound('sent');
    const text = (inputMessage.value||'').trim();
    const files = attachFile.files;
    const attachments = [];
    const conv = convIdFor(currentUser.id, activeContact.contact_user);

    if(files && files.length) {
        for(const f of files) {
            const safeName = f.name.replace(/[^a-z0-9_\-\.]/gi, '_');
            const path = `attachments/${currentUser.id}/${conv}/${Date.now()}_${safeName}`;
            const { error } = await supabase.storage.from('attachments').upload(path, f);
            if(error) { alert('Upload failed: ' + error.message); continue; }
            attachments.push({ name: f.name, type: f.type, bucket: 'attachments', path });
        }
    }

    if (!text && attachments.length === 0) return;
    
    const payload = { conversation_id: conv, from_user: currentUser.id, text: text || '' };
    if (attachments.length) payload.attachments = JSON.stringify(attachments);
    
    await supabase.from('messages').insert([payload]);
    inputMessage.value = ''; attachFile.value = ''; renderFilePreview(null);
    
    fetch('/api/send-push', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
            toUserId: activeContact.contact_user,
            title: myProfile?.username || 'New Message',
            message: text || 'Attachment',
            url: `${location.origin}?openConv=${conv}`
        })
    }).catch(()=>{});
  }

  async function clearConversation() {
      if (!activeContact) return;
      if(confirm('Delete messages?')) {
          const conv = convIdFor(currentUser.id, activeContact.contact_user);
          await supabase.from('messages').delete().eq('conversation_id', conv);
          messages.innerHTML = '';
      }
  }

  function showEmojiPicker() {
    const picker = document.createElement('div'); picker.className='emoji-picker';
    picker.style.cssText = "position:fixed; bottom:80px; left:50%; transform:translateX(-50%); background:#202c33; padding:10px; border-radius:10px; display:grid; grid-template-columns:repeat(8, 1fr); gap:5px; z-index:9999; box-shadow:0 10px 50px rgba(0,0,0,0.5); max-width:90vw;";
    const list = ['😀','😂','😍','😎','🤔','👍','👎','🎉','❤️','😭','👀','🔥','🙏','💯','👋','✨'];
    list.forEach(em => {
        const b = document.createElement('div'); b.textContent = em; b.style.fontSize='24px'; b.style.cursor='pointer'; b.style.padding='5px';
        b.onclick = (e) => { e.stopPropagation(); inputMessage.value += em; picker.remove(); };
        picker.appendChild(b);
    });
    document.body.appendChild(picker);
    setTimeout(() => { document.addEventListener('click', function close(e) { if(!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', close); } }, { once: true }); }, 100);
  }

  /* ---------- CALLING (FIXED) ---------- */
  function subscribeCallChannel(callId) {
    if (callsChannel) callsChannel.unsubscribe();
    // Listen for signals on this specific Call ID
    callsChannel = supabase.channel('call_' + callId)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'calls', filter:`call_id=eq.${callId}` }, async (payload) => {
        const row = payload.new;
        if (!row || row.from_user === currentUser.id) return; // Ignore my own signals
        
        if (row.type === 'answer') {
            await handleAnswer(row);
        } else if (row.type === 'ice' && pc) {
            try { await pc.addIceCandidate(new RTCIceCandidate(row.payload.candidate)); } catch(e){}
        } else if (row.type === 'hangup') {
            endCallLocal();
        }
      }).subscribe();
  }

  async function startCallWithActive(video=true) {
    if (!activeContact?.contact_user) return alert('User not registered');
    await startCall(activeContact.contact_user, video);
  }

  async function startCall(remoteUserId, video=true) {
    currentCallId = 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    pc = new RTCPeerConnection({ iceServers: STUN });
    
    // Send Push Notification
    fetch('/api/send-push', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ toUserId: remoteUserId, title: 'Incoming Call', message: `Call from ${myProfile?.username}`, url: location.origin }) }).catch(()=>{});

    alert('Calling...'); playSound('sent'); 

    pc.onicecandidate = async (ev) => {
       if(ev.candidate) await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: remoteUserId, type: 'ice', payload: { candidate: ev.candidate.toJSON() } }]);
    };
    pc.ontrack = (ev) => {
       avatarPreview.innerHTML = '';
       const v = document.createElement('video'); v.autoplay = true; v.playsInline=true; v.srcObject = ev.streams[0]; v.style.cssText="width:100%;height:100%;object-fit:cover";
       avatarPreview.appendChild(v);
    };

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: video, audio: true });
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    } catch(e) { return alert('Mic/Cam access denied'); }

    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    // 1. Create Call Record (Offer)
    await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: remoteUserId, type: 'offer', payload: { sdp: offer.sdp } }]);
    
    // 2. Listen for Answer
    subscribeCallChannel(currentCallId); 
  }

  async function handleOffer(row) {
      currentCallId = row.call_id;
      playSound('ring');
      if(!confirm(`Incoming call from ${row.from_user.slice(0,4)}... Accept?`)) return;

      pc = new RTCPeerConnection({ iceServers: STUN });
      pc.onicecandidate = async (ev) => {
         if(ev.candidate) await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: row.from_user, type: 'ice', payload: { candidate: ev.candidate.toJSON() } }]);
      };
      pc.ontrack = (ev) => {
         avatarPreview.innerHTML = '';
         const v = document.createElement('video'); v.autoplay = true; v.playsInline=true; v.srcObject = ev.streams[0]; v.style.cssText="width:100%;height:100%;object-fit:cover";
         avatarPreview.appendChild(v);
      };
      
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      } catch(e) { return alert('Mic/Cam access denied'); }

      await pc.setRemoteDescription({ type: 'offer', sdp: row.payload.sdp });
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: row.from_user, type: 'answer', payload: { sdp: answer.sdp } }]);
      
      subscribeCallChannel(currentCallId); // Listen for ICE candidates
  }

  async function handleAnswer(row) { if(pc) await pc.setRemoteDescription({ type: 'answer', sdp: row.payload.sdp }); }

  function endCallLocal() {
      if(pc) pc.close(); pc = null;
      if(localStream) localStream.getTracks().forEach(t=>t.stop());
      if(callsChannel) callsChannel.unsubscribe();
      avatarPreview.innerHTML = 'U';
  }

  async function startQrScan() {
      if(!window.BarcodeDetector) return handleScannedText(prompt('Paste QR data:'));
      show(modalQrScan);
      try {
          const detector = new BarcodeDetector({formats:['qr_code']});
          scannerStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
          qrVideo.srcObject = scannerStream;
          const loop = async () => {
              try {
                  const b = await createImageBitmap(qrVideo);
                  const res = await detector.detect(b);
                  if(res.length) { stopScanner(); hide(modalQrScan); handleScannedText(res[0].rawValue); return; }
              } catch(e){}
              if(!modalQrScan.classList.contains('hidden')) requestAnimationFrame(loop);
          };
          loop();
      } catch(e){ alert('Cam error: '+e.message); hide(modalQrScan); }
  }
  function stopScanner() { if(scannerStream) scannerStream.getTracks().forEach(t=>t.stop()); }
  function handleScannedText(txt) {
      if(!txt) return;
      if(txt.includes('addPhone=')) addContactPhone.value = new URL(txt).searchParams.get('addPhone');
      else addContactPhone.value = txt;
      findUserByPhoneAndAdd();
  }

  async function registerServiceWorkerAndSubscribe() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      if (!('PushManager' in window)) return;
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      const vapidKey = window.VAPID_PUBLIC_KEY;
      if (!vapidKey) return;
      
      const urlBase64ToUint8Array = (base64String) => {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
      };

      let sub = await reg.pushManager.getSubscription();
      if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });

      const keys = sub.getKey ? { p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))) } : { p256dh: '', auth: '' };
      const payload = { user_id: currentUser.id, endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth };
      await supabase.from('push_subscriptions').upsert(payload, { onConflict: 'endpoint' });
    } catch (err) { console.warn('SW Register Error:', err); }
  }

  function startPresence(){
    stopPresence();
    presenceInterval = setInterval(()=> {
      if (!currentUser) return;
      supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', currentUser.id).catch(()=>{});
    }, 15000);
  }
  function stopPresence(){ if (presenceInterval) clearInterval(presenceInterval); presenceInterval = null; }

  (async function init(){
    try {
      const s = await supabase.auth.getSession();
      if (s && s.data && s.data.session) {
        const params = new URLSearchParams(location.search);
        const addPhone = params.get('addPhone');
        await loadSession();
        if (addPhone && currentUser) {
          openAddContactModal();
          addContactPhone.value = addPhone;
          setTimeout(()=> findUserByPhoneAndAdd(), 600);
        }
      } else {
        showOnly('auth');
      }
    } catch (err) { console.error('[INIT] err', err); showOnly('auth'); }
  })();
});