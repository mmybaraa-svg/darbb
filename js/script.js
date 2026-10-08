(function () {
  'use strict';

  const KEYS = Object.freeze({
    users: 'darb_users',
    current: 'darb_current_user',
    session: 'darb_session',
    token: 'darb_access_token',
    trips: 'darb_trips',
    bookings: 'darb_bookings',
    passengerLocation: 'darb_passenger_location',
    passengerArea: 'darb_passenger_area',
    driverLocation: 'darb_driver_location',
    tracking: 'darb_tracking_state',
    notifications: 'darb_notifications',
    follows: 'darb_follows',
    ratings: 'darb_ratings',
    conversations: 'darb_conversations',
    messages: 'darb_messages'
  });

  const D = {
    KEYS,
    STORAGE: {
      get(key, fallback = []) {
        try {
          const value = localStorage.getItem(key);
          return value === null ? fallback : JSON.parse(value);
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
        window.dispatchEvent(new CustomEvent('darb:data-updated', { detail: { key } }));
      },
      remove(key) {
        localStorage.removeItem(key);
      }
    },
    getUser() { return this.STORAGE.get(KEYS.current, null); },
    setUser(user) {
      if (!user) {
        this.STORAGE.remove(KEYS.current);
        return;
      }
      const safe = { ...user };
      delete safe.password;
      delete safe.passwordHash;
      delete safe.passwordSalt;
      this.STORAGE.set(KEYS.current, safe);
    },
    users() { return this.STORAGE.get(KEYS.users, []); },
    trips() { return this.STORAGE.get(KEYS.trips, []); },
    bookings() { return this.STORAGE.get(KEYS.bookings, []); },
    uid() { return `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; },
    tid() { return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; },
    bid() { return `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`; },
    toast(message, type = 'info') {
      let item = document.querySelector('.toast');
      if (!item) {
        item = document.createElement('div');
        item.className = 'toast';
        Object.assign(item.style, {
          position: 'fixed', bottom: '18px', right: '18px', zIndex: 9999,
          maxWidth: '360px', padding: '13px 16px', borderRadius: '12px',
          background: '#142B3A', color: '#fff', boxShadow: '0 12px 30px rgba(0,0,0,.18)'
        });
        document.body.appendChild(item);
      }
      item.textContent = message;
      item.style.background = type === 'error' ? '#C0392B' : type === 'success' ? '#168A83' : '#142B3A';
      clearTimeout(item._timer);
      item._timer = setTimeout(() => item.remove(), 3500);
    },
    escape(value) {
      return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
      })[character]);
    },
    formatPrice(value) { return `${Number(value || 0).toFixed(2)} د.أ`; },
    formatDate(value) {
      if (!value) return '—';
      return new Intl.DateTimeFormat('ar-JO', { year: 'numeric', month: 'long', day: 'numeric' })
        .format(new Date(`${value}T00:00:00`));
    },
    normalizePhone(value) {
      let phone = String(value || '').replace(/[^\d+]/g, '');
      if (phone.startsWith('00962')) phone = `+962${phone.slice(5)}`;
      if (phone.startsWith('07')) phone = `+962${phone.slice(1)}`;
      if (phone.startsWith('962') && !phone.startsWith('+')) phone = `+${phone}`;
      return phone;
    },
    validPhone(value) { return /^(\+9627\d{8}|07\d{8})$/.test(this.normalizePhone(value)); },
    validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')); },
    redirect(path) { location.href = path; },
    requireAuth(role) {
      const user = this.getUser();
      if (!user) {
        const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
        location.href = `login.html?next=${next}`;
        return null;
      }
      if (role && user.role !== role) {
        location.href = user.role === 'driver' ? 'driver.html' : 'dashboard.html';
        return null;
      }
      return user;
    },
    logout() {
      const finish = () => { location.href = 'index.html'; };
      if (window.DARB_API) window.DARB_API.signOut().finally(finish);
      else {
        this.STORAGE.remove(KEYS.current);
        this.STORAGE.remove(KEYS.session);
        this.STORAGE.remove(KEYS.token);
        finish();
      }
    }
  };

  window.DARB = D;
  D.apiEnabled = true;
  D.apiAuthFormsReady = false;
  document.addEventListener('submit', (event) => {
    if (D.apiAuthFormsReady || !['loginForm', 'registerForm'].includes(event.target?.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    D.toast('الخادم غير متاح. لا يمكن تسجيل الدخول أو إنشاء حساب دون الاتصال بـ SQL Server.', 'error');
  }, true);
  D.ready = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'js/api.js';
    script.onload = () => resolve(window.DARB_API.start(D));
    script.onerror = () => {
      console.error('Failed to load SQL API client.');
      D.toast('تعذر تحميل واجهة الاتصال بالخادم.', 'error');
      resolve();
    };
    document.head.appendChild(script);
  });

  function nav() {
    const user = D.getUser();
    document.querySelectorAll('[data-auth-only]').forEach((item) => item.classList.toggle('hidden', !user));
    document.querySelectorAll('[data-role="passenger"]').forEach((item) => item.classList.toggle('hidden', !user || user.role !== 'passenger'));
    document.querySelectorAll('[data-role="driver"]').forEach((item) => item.classList.toggle('hidden', !user || user.role !== 'driver'));
    document.querySelectorAll('[data-guest]').forEach((item) => item.classList.toggle('hidden', !!user));
    const logout = document.querySelector('[data-logout]');
    if (logout) {
      logout.classList.toggle('hidden', !user);
      logout.onclick = () => D.logout();
    }
    const homeToggle = document.querySelector('[data-home-menu-toggle]');
    const homeMenu = document.querySelector('[data-home-menu]');
    if (homeToggle && homeMenu) {
      homeToggle.onclick = () => {
        const expanded = homeToggle.getAttribute('aria-expanded') === 'true';
        homeToggle.setAttribute('aria-expanded', String(!expanded));
        homeMenu.classList.toggle('hidden', expanded);
      };
    }
    const menu = document.querySelector('.menu-btn');
    const links = document.querySelector('.nav-links');
    if (menu && links) menu.onclick = () => links.classList.toggle('open');
  }

  function protect() {
    const page = document.body.dataset.page;
    const user = D.getUser();
    if (page === 'dashboard' && (!user || user.role !== 'passenger')) {
      location.href = user ? 'driver.html' : 'login.html?next=dashboard.html';
    } else if (page === 'profile' && !user) {
      location.href = 'login.html?next=profile.html';
    } else if (page === 'driver' && (!user || user.role !== 'driver')) {
      location.href = user ? 'dashboard.html' : 'login.html?next=driver.html';
    }
  }

  function renderNav() {
    const host = document.querySelector('[data-site-nav]');
    if (!host) return;
    host.innerHTML = `<nav class="nav"><div class="container nav-inner"><a class="brand" href="index.html"><span class="brand-mark">د</span><span>دَرْب</span></a><button class="menu-btn" aria-label="فتح القائمة">☰</button><div class="nav-links"><div class="nav-home-menu"><button class="nav-home-toggle" type="button" aria-expanded="false" aria-controls="homeMenu" data-home-menu-toggle>الرئيسية <span aria-hidden="true">⌄</span></button><div class="nav-home-dropdown hidden" id="homeMenu" data-home-menu><a href="trips.html">الرحلات</a><a href="index.html#how">كيف يعمل</a><a href="index.html#features">المميزات</a></div></div><span data-auth-only data-role="passenger"><a href="dashboard.html">رحلاتي</a></span><span data-auth-only data-role="driver"><a href="driver.html">رحلاتي</a></span><span data-auth-only><a href="profile.html">الملف الشخصي</a></span><a data-guest href="login.html">تسجيل الدخول</a><a class="btn btn-primary" data-guest href="register.html">إنشاء حساب</a><button class="btn btn-outline hidden" data-logout>تسجيل الخروج</button></div></div></nav>`;
    nav();
  }

  document.addEventListener('DOMContentLoaded', () => {
    D.ready.then(() => {
      renderNav();
      protect();
      document.querySelectorAll('[data-demo-banner]').forEach((banner) => {
        banner.classList.add('hidden');
        banner.textContent = '';
      });
      window.addEventListener('darb:data-updated', nav);
    });
  });
})();
