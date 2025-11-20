// app.js - final stable client code (debounced auth listener, profile flow, chat, attachments, emoji)
'use strict';

const supabase = window.supabase;
if (!supabase) throw new Error('Supabase client not initialized (check index.html)');

document.addEventListener('DOMContentLoaded', () => {

  /* DOM */
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
  const btnSaveProfile = document.getElementById('btnSaveProfile');
  const btnSkipProfile = document.getElementById('btnSkipProfile');

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
  const btnEmoji = document.getElementById('btnEmoji');
  const btnVoiceCall = document.getElementById('btnVoiceCall');
  const btnVideoCall = document.getElementById('btnVideoCall');
  const btnClearChat = document.getElementById('btnClearChat');

  const modalAddContact = document.getElementById('modalAddContact');
  const addContactName = document.getElementById('addContactName');
  const addContactUid = document.getElementById('addContactUid');
  const addContactSave = document.getElementById('addContactSave');
  const addContactCancel = document.getElementById('addContactCancel');

  /* state */
  let currentUser = null;
  let myProfile = null;
  let myContacts = [];
  let activeContact = null;
  let messageSub = null;
  
  // New: DOM references for mobile layout control
  const sidebar = document.querySelector('.sidebar');
  const chat = document.querySelector('.chat');
  
  // New: Insert a "Back" button icon for mobile view (will use a common icon for simplicity)
  const chatHeader = document.querySelector('.chat-header');
  const mobileBackButton = document.createElement('button');
  mobileBackButton.id = 'btnMobileBack';
  mobileBackButton.className = 'icon';
  mobileBackButton.title = 'Back to Contacts';
  mobileBackButton.type = 'button';
  mobileBackButton.innerHTML = '&#x2190;'; // Left Arrow icon

  /* helpers */
  function show(el) { if (el) { el.classList.remove('hidden'); el.style.display = ''; } }
  function hide(el) { if (el) { el.classList.add('hidden'); el.style.display = 'none'; } }
  function showOnly(key) {
    const map = { auth: authSection, profile: profileSection, app: appSection };
    Object.values(map).forEach(hide);
    if (map[key]) show(map[key]);
  }
  function convIdFor(a,b){ return [a,b].sort().join('_'); }
  function escapeHtml(s){ return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  
  // New: Mobile detection helper
  function isMobileView() {
      return window.innerWidth < 900;
  }
  
  // New: Mobile navigation helpers
  function showContactsList() {
      if (isMobileView()) {
          show(sidebar);
          hide(chat);
      }
      // On desktop, both are visible, so no action needed.
  }
  
  function showChat() {
      if (isMobileView()) {
          hide(sidebar);
          show(chat);
      }
  }

  // debugging helper
  window._debugScreens = () => Array.from(document.querySelectorAll('.screen')).map(s=>({id:s.id,hidden:s.classList.contains('hidden'),display:window.getComputedStyle(s).display}));

  // defensive: ensure buttons are type="button"
  [btnSignIn, btnSignUp, btnDemo, btnSSO, btnSaveProfile, btnSkipProfile, btnSendMain].forEach(b=>{ if (b) b.type='button'; });

  /* auth tabs */
  tabSignIn.addEventListener('click', ()=>{ tabSignIn.classList.add('active'); tabSignUp.classList.remove('active'); formSignIn.classList.remove('hidden'); formSignUp.classList.add('hidden'); });
  tabSignUp.addEventListener('click', ()=>{ tabSignUp.classList.add('active'); tabSignIn.classList.remove('active'); formSignUp.classList.remove('hidden'); formSignIn.classList.add('hidden'); });

  /* ---------- getSignedUrl helper (tries /api then falls back to publicUrl) ---------- */
  async function getSignedUrl(bucket, path, expires = 3600) {
    // try serverless endpoint first (if you deploy it)
    try {
      const sess = await supabase.auth.getSession();
      const token = sess?.data?.session?.access_token;
      if (token) {
        const url = `/api/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&expires=${encodeURIComponent(expires)}`;
        const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        if (resp.ok) {
          const j = await resp.json();
          return j.publicUrl || j.signedURL || j.url || j.signedUrl;
        }
      }
    } catch(e) {
      // ignore - fallback to public url
      console.warn('signed-url endpoint failed, falling back to publicUrl', e);
    }
    // fallback: public URL (works if bucket is public)
    try {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data?.publicUrl || null;
    } catch(e) {
      return null;
    }
  }

  /* ---------- evaluate session & profile flow ---------- */
  let authBusy = false;
  async function evaluateSessionFlow() {
    try {
      const s = await supabase.auth.getSession();
      currentUser = s?.data?.session?.user || null;
      if (!currentUser) { showOnly('auth'); return; }
      // profile
      const { data, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).limit(1).maybeSingle();
      if (error) {
        console.warn('profile fetch error', error);
        showOnly('profile');
        return;
      }
      if (data) {
        myProfile = data;
        showOnly('app');
        await bootMain();
      } else {
        profileName.value = currentUser.email ? currentUser.email.split('@')[0] : 'User';
        avatarPreview.textContent = (profileName.value[0]||'U').toUpperCase();
        showOnly('profile');
      }
    } catch (err) {
      console.error('evaluateSessionFlow err', err);
      showOnly('auth');
    } finally {
      authBusy = false;
      try { btnSignIn.disabled=false; btnSignUp.disabled=false; btnDemo.disabled=false; } catch {}
    }
  }

  /* ---------- auth actions (signup/signin/demo) ---------- */
  btnSignUp.addEventListener('click', async ()=> {
    if (authBusy) return;
    authBusy = true; btnSignUp.disabled = true;
    const email = (signupEmail.value||'').trim(); const password = (signupPass.value||'').trim();
    if (!email || password.length < 6) { alert('Enter valid email & password (min 6)'); authBusy=false; btnSignUp.disabled=false; return; }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { alert('Sign up error: ' + (error.message||JSON.stringify(error))); authBusy=false; btnSignUp.disabled=false; return; }
    await supabase.auth.signInWithPassword({ email, password }).catch(()=>null);
    await evaluateSessionFlow();
  });

  btnSignIn.addEventListener('click', async ()=> {
    if (authBusy) return;
    authBusy = true; btnSignIn.disabled = true;
    const email = (signinEmail.value||'').trim(), password = (signinPass.value||'').trim();
    if (!email || !password) { alert('Enter email & password'); authBusy=false; btnSignIn.disabled=false; return; }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { alert('Sign in failed: ' + (error.message||JSON.stringify(error))); authBusy=false; btnSignIn.disabled=false; return; }
    await evaluateSessionFlow();
  });

  btnDemo.addEventListener('click', async ()=> {
    if (authBusy) return;
    authBusy = true; btnDemo.disabled = true;
    const email = `demo${Date.now()%10000}@example.com`, password = 'demopass';
    await supabase.auth.signUp({ email, password }).catch(()=>null);
    await supabase.auth.signInWithPassword({ email, password }).catch(()=>null);
    await evaluateSessionFlow();
  });

  /* ---------- Debounced auth-change listener (fixes duplicate events) ---------- */
  let __evalTimer = null;
  function scheduleEvaluateSession(delay = 150) {
    if (__evalTimer) clearTimeout(__evalTimer);
    __evalTimer = setTimeout(() => {
      __evalTimer = null;
      console.log('[AUTH-DEBOUNCE] running evaluateSessionFlow()');
      evaluateSessionFlow().catch(err => console.error('[AUTH-DEBOUNCE] evaluate err', err));
    }, delay);
  }
  if (!window.__authObserver) {
    window.__authObserver = true;
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('[auth change]', event);
      scheduleEvaluateSession();
    });
  }

  /* ---------- profile setup ---------- */
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
      const f = profileAvatar.files && profileAvatar.files[0];
      let avatar_path = myProfile?.avatar_path || null;
      if (f) {
        const path = `avatars/${currentUser.id}/${Date.now()}_${f.name}`;
        const up = await supabase.storage.from('avatars').upload(path, f);
        if (up.error) throw up.error;
        avatar_path = path;
      }
      const toUpsert = { id: currentUser.id, username: name, phone, avatar_path };
      const { error } = await supabase.from('profiles').upsert(toUpsert);
      if (error) throw error;
      myProfile = toUpsert;
      showOnly('app'); await bootMain();
    } catch (err) { console.error('save profile err', err); alert('Profile save failed'); }
    finally { btnSaveProfile.disabled = false; }
  });

  btnSkipProfile.addEventListener('click', async ()=> {
    try {
      btnSkipProfile.disabled = true;
      const name = (profileName.value || currentUser.email?.split('@')[0] || 'User').trim();
      const toUpsert = { id: currentUser.id, username: name, phone: '' };
      const { error } = await supabase.from('profiles').upsert(toUpsert);
      if (error) throw error;
      myProfile = toUpsert;
      showOnly('app'); await bootMain();
    } catch (err) { console.error('skip profile err', err); alert('Could not skip'); }
    finally { btnSkipProfile.disabled = false; }
  });

  /* ---------- boot main ---------- */
  async function bootMain() {
    if (!myProfile) return;
    meName.textContent = myProfile.username || currentUser.email;
    mePhone.textContent = myProfile.phone || '—';
    if (myProfile.avatar_path) {
      const url = await getSignedUrl('avatars', myProfile.avatar_path).catch(()=>null);
      if (url) meAvatar.innerHTML = `<img src="${url}" style="width:100%;height:100%;border-radius:12px;object-fit:cover" />`;
      else meAvatar.textContent = (myProfile.username||'U')[0].toUpperCase();
    } else meAvatar.textContent = (myProfile.username||'U')[0].toUpperCase();

    // New: Append mobile back button to chat header if it doesn't exist
    if (isMobileView() && !chatHeader.querySelector('#btnMobileBack')) {
        chatHeader.prepend(mobileBackButton);
    }
    
    // New: Initial mobile screen state
    if (isMobileView()) {
        showContactsList();
    } else {
        // Desktop default state: both sidebar and chat are visible (handled by CSS)
        show(sidebar);
        show(chat);
    }

    await loadContacts();

    // wire handlers idempotently
    btnOpenProfile.onclick = () => { profileName.value = myProfile.username || ''; profilePhone.value = myProfile.phone || ''; showOnly('profile'); };
    btnAddContactMain.onclick = openAddContactModal;
    addContactCancel.onclick = closeAddContactModal;
    addContactSave.onclick = saveAddContact;
    btnRefresh.onclick = loadContacts;
    contactSearch.oninput = (e) => renderContacts(e.target.value);
    btnSendMain.onclick = sendMessageHandler;
    btnAttachMain.onclick = () => attachFile.click();
    inputMessage.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessageHandler(); } };
    btnEmoji.onclick = showEmojiPicker;
    btnVoiceCall.onclick = () => alert('Call demo — both users must be online');
    btnVideoCall.onclick = () => alert('Video call demo — both users must be online');
    btnClearChat.onclick = clearConversation;
    // New: Mobile back button handler
    mobileBackButton.onclick = showContactsList;
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
      const node = document.createElement('div'); node.className = 'contact';
      node.innerHTML = `<div class="avatar">${(name[0]||'C').toUpperCase()}</div><div style="flex:1"><div style="font-weight:600">${escapeHtml(name)}</div><div class="muted small">${escapeHtml(c.phone|| (c.contact_user || ''))}</div></div>`;
      node.onclick = () => selectContact(c);
      contactsList.appendChild(node);
    }
  }

  function openAddContactModal(){ addContactName.value=''; addContactUid.value=''; modalAddContact.classList.remove('hidden'); }
  function closeAddContactModal(){ modalAddContact.classList.add('hidden'); }

  async function saveAddContact(){
    const name = (addContactName.value || '').trim(); const uidOrPhone = (addContactUid.value||'').trim();
    if (!uidOrPhone) return alert('Enter UID or phone');
    try {
      let found = null;
      const byId = await supabase.from('profiles').select('*').eq('id', uidOrPhone).limit(1).maybeSingle();
      if (byId.data) found = byId.data;
      else {
        const byPhone = await supabase.from('profiles').select('*').eq('phone', uidOrPhone).limit(1).maybeSingle();
        if (byPhone.data) found = byPhone.data;
      }
      const contact = found ? { owner: currentUser.id, contact_user: found.id, name: name || found.username, phone: found.phone || '' } : { owner: currentUser.id, contact_user: null, name: name || uidOrPhone, phone: uidOrPhone };
      const { error } = await supabase.from('contacts').insert([contact]);
      if (error) throw error;
      closeAddContactModal(); await loadContacts();
    } catch (err) { console.error(err); alert('Could not add contact: ' + (err.message||err)); }
  }

  /* ---------- messages ---------- */
  async function selectContact(contact) {
    if (!contact.contact_user) return alert('Contact not registered. Add by UID or ask them to register.');
    activeContact = contact;
    chatTitle.textContent = contact.name || 'Contact'; chatSubtitle.textContent = contact.phone || '';
    chatAvatar.textContent = (contact.name && contact.name[0]) ? contact.name[0].toUpperCase() : 'U';
    messages.innerHTML = '<div class="muted small">Loading conversation...</div>';
    
    // New: Switch view to chat on mobile
    showChat();
    
    const conv = convIdFor(currentUser.id, contact.contact_user);
    try {
      const { data } = await supabase.from('conversations').select('*').eq('id', conv).limit(1).maybeSingle();
      if (!data) await supabase.from('conversations').insert([{ id: conv }]);
      const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', conv).order('created_at', { ascending: true }).limit(500);
      messages.innerHTML = '';
      if (msgs && msgs.length) for (const m of msgs) await renderMessageRow(m); else messages.innerHTML = '<div class="muted small">No messages yet</div>';
      if (messageSub && messageSub.unsubscribe) { messageSub.unsubscribe(); messageSub = null; }
      messageSub = supabase.channel('messages_'+conv).on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`conversation_id=eq.${conv}` }, payload => {
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

  btnSendMain.addEventListener('click', sendMessageHandler);
  async function sendMessageHandler() {
    if (!activeContact || !activeContact.contact_user) return alert('Select a registered contact');
    const text = (inputMessage.value||'').trim();
    const files = attachFile.files; const attachments = [];
    if (files && files.length) {
      for (const f of files) {
        const path = `${convIdFor(currentUser.id, activeContact.contact_user)}/${Date.now()}_${f.name}`;
        const up = await supabase.storage.from('attachments').upload(path, f);
        if (up.error) { console.warn('upload err', up.error); continue; }
        attachments.push({ name: f.name, type: f.type, bucket: 'attachments', path });
      }
      attachFile.value = '';
    }
    if (!text && attachments.length===0) return;
    const conv = convIdFor(currentUser.id, activeContact.contact_user);
    const { error } = await supabase.from('messages').insert([{ conversation_id: conv, from_user: currentUser.id, text: text||'', attachments: attachments.length ? JSON.stringify(attachments) : null }]);
    if (error) return alert('Send error: ' + error.message);
    inputMessage.value = '';
  }

  async function clearConversation() {
    if (!activeContact || !activeContact.contact_user) return alert('Select a conversation');
    if (!confirm('Clear conversation?')) return;
    const conv = convIdFor(currentUser.id, activeContact.contact_user);
    const { error } = await supabase.from('messages').delete().eq('conversation_id', conv);
    if (error) return alert('Clear error: ' + error.message);
    messages.innerHTML = '<div class="muted small">Conversation cleared</div>';
  }

  /* emoji picker */
  function showEmojiPicker() {
    const picker = document.createElement('div'); picker.className='emoji-picker';
    picker.style.position='fixed'; picker.style.bottom='86px'; picker.style.left='50%'; picker.style.transform='translateX(-50%)';
    picker.style.background='#061827'; picker.style.padding='8px'; picker.style.borderRadius='8px'; picker.style.display='grid';
    picker.style.gridTemplateColumns='repeat(8,36px)'; picker.style.gap='6px';
    const list = [
  '😀','😁','😂','🤣','😉','😊','😍','😘','😎','🤔','👍','👎','🙏','👏','💯','🔥','🎉','❤️',
  '🤩','🥳','🥲','🫠','🫡','🥹','🤗','😻','😽','🐶','🐱','🐭','🐹','🐰','🐻','🐼','🐨','🐯',
  '🦁','🐒','🦊','🦋','🐝','🐢','🐍','🐘','🦒','🦓','🐦','🦉','🐬','🐳','🦠','🍕','🍔','🍟',
  '🍿','🍩','🍪','🎂','🍰','🍫','🍎','🍊','🍋','🍒','🍇','🍉','🍓','🍍','🌶️','🥕','☕','🍵',
  '🍺','🍷','🍸','🍹','⚽','🏀','🏈','⚾','🎾','🏐','🏊','🏄','🚴','🏃','🚶','🏋️','🎨','🎭',
  '💡','💰','💸','✉️','📝','📎','✂️','📌','💼','👜','🛍️','🎁','🎈','🔔','📢','📱','💻','🖥️',
  '📷','📸','📹','📽️','📺','⭐','🌟','💫','💥','💦','☔','⚡','🌈','☀️','🌙','✨','❓','❕',
];;
    list.forEach(em => { const d=document.createElement('div'); d.textContent=em; d.style.cursor='pointer'; d.style.fontSize='20px'; d.onclick=()=>{ inputMessage.value+=em; try{ document.body.removeChild(picker);}catch{} }; picker.appendChild(d); });
    document.body.appendChild(picker);
    setTimeout(()=> document.addEventListener('click', function rm(ev){ if (!picker.contains(ev.target)) try{ document.body.removeChild(picker);}catch{} document.removeEventListener('click', rm); }), 50);
  }

  /* init: check current session and schedule evaluate */
  (async function init(){
    try {
      const s = await supabase.auth.getSession();
      if (s && s.data && s.data.session) scheduleEvaluateSession(0);
      else showOnly('auth');
    } catch (err) {
      console.error('[INIT] getSession err', err);
      showOnly('auth');
    }

    // local helper exposed for debugging
    function scheduleEvaluateSession(delay = 150) {
      if (window.__authEvalTimer) clearTimeout(window.__authEvalTimer);
      window.__authEvalTimer = setTimeout(() => {
        window.__authEvalTimer = null;
        console.log('[AUTH-DEBOUNCE] running evaluateSessionFlow() from init');
        evaluateSessionFlow().catch(e=>console.error(e));
      }, delay);
    }

    // attach debounced global listener (ensure single install)
    if (!window.__authListenerInstalled) {
      window.__authListenerInstalled = true;
      supabase.auth.onAuthStateChange((event, session) => {
        console.log('[auth change]', event);
        if (window.__authEvalTimer) clearTimeout(window.__authEvalTimer);
        window.__authEvalTimer = setTimeout(() => { window.__authEvalTimer = null; evaluateSessionFlow().catch(e=>console.error(e)); }, 150);
      });
    }
  })();

});