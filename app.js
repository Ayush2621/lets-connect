// app.js — full client (auth, profile, contacts, realtime chat, attachments, WebRTC, QR, Push)
// NOTE: After login/profile save this registers service worker & subscribes for push (stores subscription in Supabase)
'use strict';

const supabase = window.supabase;
if (!supabase) throw new Error('Supabase client missing (check index.html)');

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
  const btnSSO = document.getElementById('btnSSO');

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
  let presenceInterval = null;

  // WebRTC
  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let currentCallId = null;
  let callsChannel = null;
  let scannerStream = null;

  const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

  /* ---------- helpers ---------- */
  function show(el) { if (!el) return; el.classList.remove('hidden'); el.style.display=''; el.removeAttribute('aria-hidden'); }
  function hide(el) { if (!el) return; el.classList.add('hidden'); el.style.display='none'; el.setAttribute('aria-hidden','true'); }
  function showOnly(key) { const map = { auth: authSection, profile: profileSection, app: appSection }; Object.values(map).forEach(hide); if (map[key]) show(map[key]); }
  function convIdFor(a,b){ return [a,b].sort().join('_'); }
  function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function isMobile(){ return window.innerWidth < 900; }

  /* ---------- notification sound (WebAudio) ---------- */
  function playNotification() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 1200;
      g.gain.value = 0.001;
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0.001, now);
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      o.frequency.setValueAtTime(1200, now);
      o.frequency.exponentialRampToValueAtTime(650, now + 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      o.start(now);
      o.stop(now + 0.25);
      setTimeout(()=> { try{ ctx.close(); }catch(e){} }, 500);
    } catch (e) {
      try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=').play(); } catch(e) {}
    }
  }

  /* ---------- signed url helper (tries serverless then public) ---------- */
  async function getSignedUrl(bucket, path, expires = 3600) {
    try {
      const s = await supabase.auth.getSession();
      const token = s?.data?.session?.access_token;
      if (token) {
        const resp = await fetch(`/api/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&expires=${encodeURIComponent(expires)}`, { headers: { Authorization: 'Bearer ' + token }});
        if (resp.ok) {
          const j = await resp.json();
          return j.signedUrl || j.signedURL || j.publicUrl || j.url || null;
        }
      }
    } catch(e){ console.warn('signed-url endpoint failed', e); }
    try {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data?.publicUrl || null;
    } catch(e){ return null; }
  }

  /* ---------- push (service worker + subscription) ---------- */
  async function registerServiceWorkerAndSubscribe() {
    if (!('serviceWorker' in navigator)) { console.warn('No service worker support'); return null; }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered', reg);

      if (!('PushManager' in window)) { console.warn('Push not supported'); return null; }

      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { console.warn('Push permission not granted'); return null; }

      const vapidKey = window.VAPID_PUBLIC_KEY;
      if (!vapidKey) { console.warn('No VAPID key set on window.VAPID_PUBLIC_KEY'); return null; }
      const urlBase64ToUint8Array = (base64String) => {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
      };

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });

      const keys = sub.getKey ? {
        p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
        auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth'))))
      } : { p256dh: '', auth: '' };

      const payload = {
        user_id: currentUser.id,
        endpoint: sub.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth
      };

      const { error } = await supabase.from('push_subscriptions').insert([payload]);
      if (error) console.warn('save subscription error', error); else console.log('push subscription saved');

      return sub;
    } catch (err) {
      console.warn('register/subscribe err', err);
      return null;
    }
  }

  /* ---------- auth ---------- */
  let authBusy = false;
  async function loadSession() {
    try {
      const s = await supabase.auth.getSession();
      currentUser = s?.data?.session?.user || null;
      if (!currentUser) { showOnly('auth'); stopPresence(); return; }

      const { data, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).limit(1).maybeSingle();
      if (error) { console.warn('profile fetch err', error); showOnly('profile'); return; }
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

  btnSignUp.addEventListener('click', async()=> {
    if (authBusy) return; authBusy=true; btnSignUp.disabled=true;
    const email = (signupEmail.value||'').trim(), password = (signupPass.value||'').trim();
    if (!email || password.length < 6) { alert('Enter valid email & password (min 6)'); authBusy=false; btnSignUp.disabled=false; return; }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { alert('Sign up error: ' + (error.message||JSON.stringify(error))); authBusy=false; btnSignUp.disabled=false; return; }
    await supabase.auth.signInWithPassword({ email, password }).catch(()=>null);
    await loadSession();
  });

  btnSignIn.addEventListener('click', async()=> {
    if (authBusy) return; authBusy=true; btnSignIn.disabled=true;
    const email = (signinEmail.value||'').trim(), password = (signinPass.value||'').trim();
    if (!email || !password) { alert('Enter email & password'); authBusy=false; btnSignIn.disabled=false; return; }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { alert('Sign in failed: ' + (error.message||JSON.stringify(error))); authBusy=false; btnSignIn.disabled=false; return; }
    await loadSession();
  });

  btnDemo.addEventListener('click', async()=> {
    if (authBusy) return; authBusy=true; btnDemo.disabled=true;
    const email = `demo${Date.now()%10000}@example.com`, password = 'demopass';
    await supabase.auth.signUp({ email, password }).catch(()=>null);
    await supabase.auth.signInWithPassword({ email, password }).catch(()=>null);
    await loadSession();
  });

  tabSignIn.addEventListener('click', ()=>{ tabSignIn.classList.add('active'); tabSignUp.classList.remove('active'); formSignIn.classList.remove('hidden'); formSignUp.classList.add('hidden'); });
  tabSignUp.addEventListener('click', ()=>{ tabSignUp.classList.add('active'); tabSignIn.classList.remove('active'); formSignUp.classList.remove('hidden'); formSignIn.classList.add('hidden'); });

  if (!window.__authObserver) {
    window.__authObserver = true;
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('[auth change]', event);
      setTimeout(()=> loadSession().catch(e=>console.error(e)), 120);
    });
  }

  /* ---------- profile ---------- */
  profileAvatar.addEventListener('change', (e)=> {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    avatarPreview.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:12px;object-fit:cover" />`;
  });

  btnSaveProfile.addEventListener('click', async ()=> {
    try {
      btnSaveProfile.disabled = true;
      const name = (profileName.value||'User').trim();
      const phone = (profilePhone.value||'').trim();
      if (!phone) { alert('Please enter phone (used to find you)'); btnSaveProfile.disabled = false; return; }
      const f = profileAvatar.files && profileAvatar.files[0];
      let avatar_path = myProfile?.avatar_path || null;
      if (f) {
        const path = `avatars/${currentUser.id}/${Date.now()}_${f.name.replace(/[^a-z0-9_\-\.]/gi,'_')}`;
        const up = await supabase.storage.from('avatars').upload(path, f);
        if (up.error) throw up.error;
        avatar_path = path;
      }
      const toUpsert = { id: currentUser.id, username: name, phone, avatar_path, last_seen: new Date().toISOString() };
      const { error } = await supabase.from('profiles').upsert(toUpsert);
      if (error) throw error;
      myProfile = toUpsert;
      showOnly('app');
      await bootMain();
      // register SW & subscribe for push after profile saved
      registerServiceWorkerAndSubscribe().catch(e=>console.warn('push register err', e));
    } catch (err) { console.error('save profile err', err); alert('Profile save failed'); }
    finally { btnSaveProfile.disabled = false; }
  });

  btnSkipProfile.addEventListener('click', async ()=> {
    try {
      btnSkipProfile.disabled = true;
      const name = (profileName.value || currentUser.email?.split('@')[0] || 'User').trim();
      const toUpsert = { id: currentUser.id, username: name, phone: '', last_seen: new Date().toISOString() };
      const { error } = await supabase.from('profiles').upsert(toUpsert);
      if (error) throw error;
      myProfile = toUpsert;
      showOnly('app'); await bootMain();
      registerServiceWorkerAndSubscribe().catch(e=>console.warn('push register err', e));
    } catch (err) { console.error('skip profile err', err); alert('Could not skip'); }
    finally { btnSkipProfile.disabled = false; }
  });

  /* ---------- presence ---------- */
  function startPresence(){
    stopPresence();
    presenceInterval = setInterval(()=> {
      if (!currentUser) return;
      supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', currentUser.id).catch(()=>{});
    }, 15000);
  }
  function stopPresence(){ if (presenceInterval) clearInterval(presenceInterval); presenceInterval = null; }

  /* ---------- main boot ---------- */
  async function bootMain() {
    if (!myProfile) return;
    meName.textContent = myProfile.username || currentUser.email;
    mePhone.textContent = myProfile.phone || '—';
    if (profilePhoneDisplay) profilePhoneDisplay.textContent = myProfile.phone || '—';
    if (myProfile.avatar_path) {
      const url = await getSignedUrl('avatars', myProfile.avatar_path).catch(()=>null);
      if (url) meAvatar.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:12px;object-fit:cover" />`;
      else meAvatar.textContent = (myProfile.username||'U')[0].toUpperCase();
    } else meAvatar.textContent = (myProfile.username||'U')[0].toUpperCase();

    await loadContacts();

    btnOpenProfile.onclick = ()=> { profileName.value = myProfile.username || ''; profilePhone.value = myProfile.phone || ''; showOnly('profile'); };
    btnAddContactMain.onclick = openAddContactModal;
    addContactCancel.onclick = closeAddContactModal;
    addContactSave.onclick = saveAddContact;
    btnFindByPhone.onclick = findUserByPhoneAndAdd;
    btnRefresh.onclick = loadContacts;
    contactSearch.oninput = (e)=> renderContacts(e.target.value);
    btnSendMain.onclick = sendMessageHandler;
    btnAttachMain.onclick = ()=> attachFile.click();
    attachFile.addEventListener('change', (e)=> renderFilePreview(e.target.files));
    inputMessage.addEventListener('keydown', (e)=> { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessageHandler(); } });
    btnEmoji.onclick = showEmojiPicker;
    btnVoiceCall.onclick = ()=> startCallWithActive(false);
    btnVideoCall.onclick = ()=> startCallWithActive(true);
    btnClearChat.onclick = clearConversation;

    // QR handlers
    if (btnShowQr) btnShowQr.addEventListener('click', ()=> {
      const phone = myProfile?.phone || profilePhone.value || '';
      if (!phone) return alert('Set your phone in profile first.');
      const appUrl = location.origin;
      const payload = `${appUrl}/?addPhone=${encodeURIComponent(phone)}`;
      const imgUrl = `https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=${encodeURIComponent(payload)}`;
      qrImage.src = imgUrl;
      show(modalQr);
    });
    if (qrClose) qrClose.addEventListener('click', ()=> hide(modalQr));

    if (btnScanQr) btnScanQr.addEventListener('click', async ()=> {
      // fallback to manual paste if BarcodeDetector not available
      if (!('BarcodeDetector' in window)) {
        const pasted = prompt('Paste QR text / phone here (format: full URL with ?addPhone=... or raw phone):');
        if (!pasted) return;
        handleScannedText(pasted);
        return;
      }
      show(modalQrScan);
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        qrVideo.srcObject = scannerStream;
        qrVideo.play();
        const scanLoop = async () => {
          try {
            const bitmap = await createImageBitmap(qrVideo);
            const results = await detector.detect(bitmap);
            if (results && results.length) {
              const text = results[0].rawValue;
              stopScanner();
              handleScannedText(text);
              hide(modalQrScan);
              return;
            }
          } catch(e){ /* ignore decoding errors */ }
          if (!modalQrScan.classList.contains('hidden')) requestAnimationFrame(scanLoop);
        };
        requestAnimationFrame(scanLoop);
      } catch (err) {
        alert('Camera error: ' + (err.message || err));
        hide(modalQrScan);
      }
    });
    if (qrScanClose) qrScanClose.addEventListener('click', ()=> { stopScanner(); hide(modalQrScan); });

    // register service worker & subscribe if not already done
    registerServiceWorkerAndSubscribe().catch(e=>console.warn('push register err', e));
  }

  /* ---------- contacts ---------- */
  async function loadContacts() {
    contactsList.innerHTML = '<div class="muted small">Loading...</div>';
    try {
      const { data, error } = await supabase.from('contacts').select('*').eq('owner', currentUser.id).order('created_at', { ascending: true });
      if (error) throw error;
      myContacts = data || [];
      renderContacts();
    } catch (err) { console.warn(err); contactsList.innerHTML = '<div class="muted small">Could not load contacts</div>'; }
  }

  function renderContacts(filter='') {
    contactsList.innerHTML = '';
    if (!myContacts || myContacts.length === 0) { contactsList.innerHTML = '<div class="muted small">No contacts. Add someone to start chatting.</div>'; return; }
    const q = (filter||'').trim().toLowerCase();
    for (const c of myContacts) {
      const name = c.name || (c.contact_user || c.phone || 'Contact');
      if (q && !(name.toLowerCase().includes(q) || (c.phone||'').includes(q))) continue;
      const node = document.createElement('div'); node.className = 'contact' + (activeContact && activeContact.id === c.id ? ' active' : '');
      node.innerHTML = `<div class="avatar">${(name[0]||'C').toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-weight:600">${escapeHtml(name)}</div>
          <div class="muted small">${escapeHtml(c.phone || (c.contact_user || ''))}</div>
        </div>`;
      node.onclick = ()=> selectContact(c);
      contactsList.appendChild(node);
    }
  }

  function openAddContactModal(){ addContactName.value=''; addContactPhone.value=''; modalAddContact.classList.remove('hidden'); }
  function closeAddContactModal(){ modalAddContact.classList.add('hidden'); }

  async function findUserByPhoneAndAdd(){
    const phone = (addContactPhone.value || '').trim();
    if (!phone) return alert('Enter phone number to search.');
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('phone', phone).limit(1).maybeSingle();
      if (error) throw error;
      if (data) {
        const contact = { owner: currentUser.id, contact_user: data.id, name: data.username || data.id, phone: data.phone || '' };
        const { error: err2 } = await supabase.from('contacts').insert([contact]);
        if (err2) throw err2;
        alert('Contact added: ' + (data.username || data.phone));
        closeAddContactModal(); await loadContacts();
      } else {
        alert('No user found with that phone number.');
      }
    } catch (err) {
      console.error('findUserByPhoneAndAdd', err);
      alert('Search failed: ' + (err.message || err));
    }
  }

  async function saveAddContact(){
    const name = (addContactName.value||'').trim(); const phone = (addContactPhone.value||'').trim();
    if (!phone) return alert('Enter phone');
    try {
      const byPhone = await supabase.from('profiles').select('*').eq('phone', phone).limit(1).maybeSingle();
      let found = byPhone.data || null;
      const contact = found ? { owner: currentUser.id, contact_user: found.id, name: name || found.username, phone: found.phone || '' } : { owner: currentUser.id, contact_user: null, name: name || phone, phone };
      const { error } = await supabase.from('contacts').insert([contact]);
      if (error) throw error;
      closeAddContactModal(); await loadContacts();
      if (!found) alert('Contact added as phone-only. If they register later with this phone they will become clickable.');
    } catch (err) { console.error(err); alert('Could not add contact: ' + (err.message||err)); }
  }

  /* ---------- messages ---------- */
  async function selectContact(contact) {
    if (!contact.contact_user) return alert('Contact is not a registered user yet. They must register (use the same phone) to chat.');
    activeContact = contact;
    chatTitle.textContent = contact.name || 'Contact';
    chatSubtitle.textContent = contact.phone || '';
    chatAvatar.textContent = (contact.name && contact.name[0]) ? contact.name[0].toUpperCase() : 'U';
    messages.innerHTML = '<div class="muted small">Loading conversation...</div>';
    if (isMobile()) { hide(document.querySelector('.sidebar')); show(document.querySelector('.chat')); }

    const conv = convIdFor(currentUser.id, contact.contact_user);
    try {
      const { data } = await supabase.from('conversations').select('*').eq('id', conv).limit(1).maybeSingle();
      if (!data) await supabase.from('conversations').insert([{ id: conv }]);
      const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', conv).order('created_at', { ascending: true }).limit(500);
      messages.innerHTML = '';
      if (msgs && msgs.length) for (const m of msgs) await renderMessageRow(m); else messages.innerHTML = '<div class="muted small">No messages yet</div>';
      if (messageSub && messageSub.unsubscribe) messageSub.unsubscribe();
      messageSub = supabase.channel('messages_'+conv).on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`conversation_id=eq.${conv}` }, payload => {
        if (payload && payload.new && payload.new.from_user !== currentUser.id) {
          // play local sound
          playNotification();
          // page-visible push will be handled by service worker if in background
        }
        renderMessageRow(payload.new); messages.scrollTop = messages.scrollHeight;
      }).subscribe();
    } catch (err) { console.error(err); messages.innerHTML = '<div class="muted small">Could not load messages</div>'; }
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
          const url = await getSignedUrl(a.bucket || 'attachments', a.path).catch(()=>null);
          if (a.type && a.type.startsWith && a.type.startsWith('image/')) html += url ? `<img class="file-thumb" src="${url}" />` : `<div class="small">[image]</div>`;
          else if (a.type && a.type.startsWith && a.type.startsWith('video/')) html += url ? `<video controls class="file-thumb" src="${url}"></video>` : `<div class="small">[video]</div>`;
          else html += url ? `<div class="doc-thumb">📄 <a download="${escapeHtml(a.name)}" href="${url}">${escapeHtml(a.name)}</a></div>` : `<div class="doc-thumb">📄 ${escapeHtml(a.name)}</div>`;
        }
        html += `</div>`;
      } catch (e) { html += `<div class="small">[attachment]</div>`; }
    }
    html += `<div class="time">${new Date(m.created_at).toLocaleString()}</div>`;
    el.innerHTML = html; messages.appendChild(el); messages.scrollTop = messages.scrollHeight;
  }

  function renderFilePreview(files) {
    if (!filePreview) return;
    filePreview.innerHTML = '';
    if (!files || files.length === 0) return;
    const frag = document.createDocumentFragment();
    for (const f of files) {
      const item = document.createElement('div'); item.className = 'file-item';
      if (f.type && f.type.startsWith('image/')) {
        const thumb = document.createElement('img'); thumb.src = URL.createObjectURL(f); thumb.onload = ()=> URL.revokeObjectURL(thumb.src);
        item.appendChild(thumb);
      } else {
        const ic = document.createElement('div'); ic.textContent = '📄'; ic.style.fontSize='20px'; item.appendChild(ic);
      }
      const meta = document.createElement('div'); meta.innerHTML = `<div style="font-weight:600">${escapeHtml(f.name)}</div><div class="muted small">${Math.round(f.size/1024)} KB • ${escapeHtml(f.type||'file')}</div>`;
      item.appendChild(meta); frag.appendChild(item);
    }
    filePreview.appendChild(frag);
  }

  async function sendMessageHandler() {
    if (!activeContact || !activeContact.contact_user) return alert('Select a registered contact');
    const text = (inputMessage.value||'').trim();
    const files = attachFile.files;
    const attachments = [];

    try {
      if (files && files.length) {
        for (const f of files) {
          const safeName = f.name.replace(/[^a-z0-9_\-\.]/gi, '_');
          const conv = convIdFor(currentUser.id, activeContact.contact_user);
          const path = `attachments/${currentUser.id}/${conv}/${Date.now()}_${safeName}`;
          const up = await supabase.storage.from('attachments').upload(path, f);
          if (up.error) {
            console.warn('upload err', up.error);
            alert('Upload failed for file: ' + f.name + '\n' + (up.error.message || JSON.stringify(up.error)));
            continue;
          }
          attachments.push({ name: f.name, type: f.type, bucket: 'attachments', path });
        }
        attachFile.value = '';
        renderFilePreview(null);
      }

      if (!text && attachments.length === 0) return alert('Enter message or attach a file.');

      const conv = convIdFor(currentUser.id, activeContact.contact_user);
      const payload = { conversation_id: conv, from_user: currentUser.id, text: text || '' };
      if (attachments.length) payload.attachments = JSON.stringify(attachments);

      const { error } = await supabase.from('messages').insert([payload]);
      if (error) throw error;
      inputMessage.value = '';

      // trigger server push to recipient (server must be deployed)
      try {
        fetch('/api/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toUserId: activeContact.contact_user,
            title: myProfile?.username || 'New message',
            body: text ? (text.length > 120 ? text.slice(0,120) + '...' : text) : '📎 Attachment',
            url: `${location.origin}?openConv=${encodeURIComponent(conv)}`,
            tag: `msg_${conv}`
          })
        }).catch(e => console.warn('push call fail', e));
      } catch(e){ console.warn('push send error', e); }

    } catch (err) {
      console.error('Send message error', err);
      alert('Could not send message: ' + (err.message || err));
    }
  }

  async function clearConversation() {
    if (!activeContact || !activeContact.contact_user) return alert('Select a conversation');
    if (!confirm('Clear conversation?')) return;
    const conv = convIdFor(currentUser.id, activeContact.contact_user);
    const { error } = await supabase.from('messages').delete().eq('conversation_id', conv);
    if (error) return alert('Clear error: ' + error.message);
    messages.innerHTML = '<div class="muted small">Conversation cleared</div>';
  }

  /* ---------- emoji ---------- */
  function showEmojiPicker() {
    const picker = document.createElement('div'); picker.className='emoji-picker';
    picker.style.position='fixed'; picker.style.bottom='86px'; picker.style.left='50%'; picker.style.transform='translateX(-50%)';
    picker.style.background='#061827'; picker.style.padding='8px'; picker.style.borderRadius='8px'; picker.style.display='grid';
    picker.style.gridTemplateColumns='repeat(8,36px)'; picker.style.gap='6px';
    const list =  [
  '😀','😁','😂','🤣','😉','😊','😍','😘','😎','🤔','👍','👎','🙏','👏','💯','🔥','🎉','❤️',
  '🤩','🥳','🥲','🫠','🫡','🥹','🤗','😻','😽','🐶','🐱','🐭','🐹','🐰','🐻','🐼','🐨','🐯',
  '🦁','🐒','🦊','🦋','🐝','🐢','🐍','🐘','🦒','🦓','🐦','🦉','🐬','🐳','🦠','🍕','🍔','🍟',
  '🍿','🍩','🍪','🎂','🍰','🍫','🍎','🍊','🍋','🍒','🍇','🍉','🍓','🍍','🌶️','🥕','☕','🍵',
  '🍺','🍷','🍸','🍹','⚽','🏀','🏈','⚾','🎾','🏐','🏊','🏄','🚴','🏃','🚶','🏋️','🎨','🎭',
  '💡','💰','💸','✉️','📝','📎','✂️','📌','💼','👜','🛍️','🎁','🎈','🔔','📢','📱','💻','🖥️',
  '📷','📸','📹','📽️','📺','⭐','🌟','💫','💥','💦','☔','⚡','🌈','☀️','🌙','✨','❓','❕',
];
    list.forEach(em => { const d=document.createElement('div'); d.textContent=em; d.style.cursor='pointer'; d.style.fontSize='20px'; d.onclick=()=>{ inputMessage.value+=em; try{ document.body.removeChild(picker);}catch{} }; picker.appendChild(d); });
    document.body.appendChild(picker);
    setTimeout(()=> document.addEventListener('click', function rm(ev){ if (!picker.contains(ev.target)) try{ document.body.removeChild(picker);}catch{} document.removeEventListener('click', rm); }), 50);
  }

  /* ---------- WebRTC signaling (unchanged) ---------- */
  function subscribeCallChannel(callId) {
    if (callsChannel && callsChannel.unsubscribe) callsChannel.unsubscribe();
    callsChannel = supabase.channel('call_' + callId)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'calls', filter:`call_id=eq.${callId}` }, async (payload) => {
        const row = payload.new;
        if (!row) return;
        if (row.from_user === currentUser.id) return;
        if (row.type === 'offer') await handleOffer(row);
        else if (row.type === 'answer') await handleAnswer(row);
        else if (row.type === 'ice') {
          const cand = row.payload && row.payload.candidate;
          if (cand && pc) {
            try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { console.warn('addIceCandidate failed', e, cand); }
          }
        } else if (row.type === 'hangup') {
          endCallLocal();
        }
      })
      .subscribe()
      .then(()=> console.log('[call channel] subscribed', callId))
      .catch(e => console.warn('[call channel] subscribe err', e));
  }

  async function startCallWithActive(withVideo=true) {
    if (!activeContact || !activeContact.contact_user) return alert('Select a registered contact');
    await startCall(activeContact.contact_user, withVideo);
  }

  async function startCall(remoteUserId, withVideo=true) {
    currentCallId = 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    pc = new RTCPeerConnection({ iceServers: STUN });
    remoteStream = new MediaStream();

    alert('Calling — allow camera/mic if prompted. Waiting for callee to accept.');

    pc.ontrack = e => {
      try {
        avatarPreview.innerHTML = `<video autoplay playsinline style="width:100%;height:100%;border-radius:12px;object-fit:cover"></video>`;
        avatarPreview.querySelector('video').srcObject = e.streams[0];
      } catch(e){ console.warn('ontrack attach err', e); }
    };

    pc.onicecandidate = async (ev) => {
      if (!ev.candidate) return;
      const candidateObj = ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate;
      await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: remoteUserId, type: 'ice', payload: { candidate: candidateObj } }]).catch(()=>{});
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: withVideo, audio: true });
      avatarPreview.innerHTML = `<video autoplay playsinline muted style="width:100%;height:100%;border-radius:12px;object-fit:cover"></video>`;
      avatarPreview.querySelector('video').srcObject = localStream;
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    } catch (e) { alert('Camera/mic error: ' + (e.message || e)); return; }

    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: remoteUserId, type: 'offer', payload: { sdp: offer.sdp } }]).catch(e=>console.warn('offer insert err', e));
    subscribeCallChannel(currentCallId);
  }

  async function handleOffer(row) {
    const remoteUserId = row.from_user;
    currentCallId = row.call_id;

    const accept = confirm('Incoming call — accept?');
    if (!accept) return;

    pc = new RTCPeerConnection({ iceServers: STUN });
    pc.ontrack = e => {
      try {
        avatarPreview.innerHTML = `<video autoplay playsinline style="width:100%;height:100%;border-radius:12px;object-fit:cover"></video>`;
        avatarPreview.querySelector('video').srcObject = e.streams[0];
      } catch(e){ console.warn('ontrack err', e); }
    };
    pc.onicecandidate = async (ev) => {
      if (!ev.candidate) return;
      const candidateObj = ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate;
      await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: remoteUserId, type: 'ice', payload: { candidate: candidateObj } }]).catch(()=>{});
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
      avatarPreview.innerHTML = `<video autoplay playsinline muted style="width:100%;height:100%;border-radius:12px;object-fit:cover"></video>`;
      avatarPreview.querySelector('video').srcObject = localStream;
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    } catch (e) { alert('Camera/mic denied: ' + (e.message || e)); return; }

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: row.payload.sdp });
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      await supabase.from('calls').insert([{ call_id: currentCallId, from_user: currentUser.id, to_user: row.from_user, type: 'answer', payload: { sdp: answer.sdp } }]).catch(e=>console.warn('answer insert err', e));
      subscribeCallChannel(currentCallId);
    } catch (err) { console.error('handleOffer err', err); }
  }

  async function handleAnswer(row) {
    if (!pc) { console.warn('handleAnswer: no pc'); return; }
    try { await pc.setRemoteDescription({ type: 'answer', sdp: row.payload.sdp }); } catch (err) { console.error('handleAnswer err', err); }
  }

  function endCallLocal() {
    try { if (pc) pc.close(); } catch(e){}
    pc = null;
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (remoteStream) { remoteStream.getTracks().forEach(t=>t.stop()); remoteStream = null; }
    if (callsChannel && callsChannel.unsubscribe) callsChannel.unsubscribe();
    callsChannel = null;
    currentCallId = null;
    if (myProfile && myProfile.avatar_path) {
      getSignedUrl('avatars', myProfile.avatar_path, 3600).then(url => { avatarPreview.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:12px;object-fit:cover" />`; }).catch(()=> avatarPreview.textContent = (myProfile.username||'U')[0].toUpperCase());
    } else avatarPreview.textContent = (myProfile && myProfile.username ? myProfile.username[0].toUpperCase() : 'U');
  }

  /* ---------- QR scan helpers ---------- */
  function stopScanner(){
    try { if (scannerStream) { scannerStream.getTracks().forEach(t=>t.stop()); scannerStream=null; } } catch(e){}
    try { qrVideo.srcObject = null; } catch(e){}
  }

  function handleScannedText(text) {
    try {
      let phone = null;
      if (text.includes('addPhone=')) {
        const u = new URL(text);
        phone = u.searchParams.get('addPhone');
      } else if (/^\+?[0-9\-\s]{6,}$/.test(text)) phone = text.trim();
      if (!phone) { alert('Could not parse phone from QR: ' + text); return; }
      addContactPhone.value = phone;
      findUserByPhoneAndAdd();
    } catch (e) {
      alert('Scan parse error: ' + (e.message || e));
    }
  }

  /* ---------- init ---------- */
  (async function init(){
    try {
      const s = await supabase.auth.getSession();
      if (s && s.data && s.data.session) {
        // if URL contains addPhone param, persist it to handle after login
        const params = new URLSearchParams(location.search);
        const addPhone = params.get('addPhone');
        await loadSession();
        // if currentUser exists and addPhone present, attempt add
        if (addPhone && currentUser) {
          openAddContactModal();
          addContactPhone.value = addPhone;
          setTimeout(()=> findUserByPhoneAndAdd(), 600);
        }
      } else {
        showOnly('auth');
      }
    } catch (err) { console.error('[INIT] getSession err', err); showOnly('auth'); }
  })();

});
