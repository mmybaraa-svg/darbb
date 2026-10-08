(function () {
  'use strict';

  const D = window.DARB;
  const baseUrl = window.DARB_API_BASE_URL || '';
  let syncing = false;
  let refreshTimer;
  const transactionalTrips = new Set();

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    const token = D.STORAGE.get(D.KEYS.token, '');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${baseUrl}/api${path}`, { ...options, headers });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `تعذر تنفيذ الطلب (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function cache(key, value) {
    syncing = true;
    try {
      D.STORAGE.set(key, value);
    } finally {
      syncing = false;
    }
  }

  async function refresh() {
    const trips = await request('/trips');
    cache(D.KEYS.trips, trips);
    const token = D.STORAGE.get(D.KEYS.token, '');
    if (!token) {
      cache(D.KEYS.bookings, []);
      cache(D.KEYS.users, []);
      cache(D.KEYS.notifications, []);
      D.setUser(null);
      return;
    }
    try {
      const [user, bookings, users, notifications] = await Promise.all([
        request('/auth/me'),
        request('/bookings'),
        request('/users'),
        request('/notifications')
      ]);
      D.setUser(user);
      cache(D.KEYS.bookings, bookings);
      cache(D.KEYS.notifications, notifications);
      const publicUsers = users.filter((item) => item.id !== user.id);
      publicUsers.push(user);
      cache(D.KEYS.users, publicUsers);
      const [tracking, locations] = await Promise.all([
        request('/records/tracking'),
        request('/records/location')
      ]);
      cache(D.KEYS.tracking, tracking.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null);
      const byBooking = new Map(locations.map((item) => [item.id, item]));
      cache(D.KEYS.trips, trips.map((trip) => {
        const location = [...byBooking.values()].find((item) => item.tripId === trip.id && item.driverLocation);
        return location ? { ...trip, driverLocation: location.driverLocation } : trip;
      }));
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        D.STORAGE.remove(D.KEYS.token);
        D.STORAGE.remove(D.KEYS.session);
        D.setUser(null);
        cache(D.KEYS.bookings, []);
        cache(D.KEYS.users, []);
        cache(D.KEYS.notifications, []);
      }
      throw error;
    }
  }

  async function syncTrips(previous, current) {
    const oldById = new Map(previous.map((trip) => [trip.id, trip]));
    const newById = new Map(current.map((trip) => [trip.id, trip]));
    for (const [id, trip] of newById) {
      if (transactionalTrips.delete(id)) continue;
      if (JSON.stringify(oldById.get(id)) === JSON.stringify(trip)) continue;
      const safeTrip = { ...trip };
      delete safeTrip.driverLocation;
      if (oldById.has(id)) await request(`/trips/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(safeTrip) });
      else await request('/trips', { method: 'POST', body: JSON.stringify(safeTrip) });
    }
    for (const id of oldById.keys()) {
      if (!newById.has(id)) await request(`/trips/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
  }

  async function syncBookings(previous, current) {
    const oldById = new Map(previous.map((booking) => [booking.id, booking]));
    const newById = new Map(current.map((booking) => [booking.id, booking]));
    for (const [id, booking] of newById) {
      const oldBooking = oldById.get(id);
      if (!oldBooking) {
        await request('/bookings', { method: 'POST', body: JSON.stringify(booking) });
      } else if (oldBooking.status !== booking.status) {
        if (booking.status === 'confirmed') transactionalTrips.add(booking.tripId);
        await request(`/bookings/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: booking.status })
        });
      }
    }
  }

  async function saveLocation(kind, value, user) {
    if (kind === 'passenger') {
      await request(`/records/location/passenger_${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...value, kind: 'passenger' })
      });
      return;
    }
    const bookings = D.bookings().filter((booking) => booking.driverId === user.id && booking.status === 'confirmed');
    await Promise.all(bookings.map((booking) => request(`/records/location/${encodeURIComponent(booking.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        tripId: booking.tripId,
        relatedId: booking.passengerId,
        driverLocation: { ...value, driverId: user.id },
        kind: 'driver'
      })
    })));
  }

  function hookStorage() {
    const originalSet = D.STORAGE.set.bind(D.STORAGE);
    D.STORAGE.set = (key, value) => {
      const previous = D.STORAGE.get(key, []);
      originalSet(key, value);
      const user = D.getUser();
      if (syncing || !user) return;
      let operation;
      if (key === D.KEYS.trips) operation = syncTrips(Array.isArray(previous) ? previous : [], Array.isArray(value) ? value : []);
      else if (key === D.KEYS.bookings) operation = syncBookings(Array.isArray(previous) ? previous : [], Array.isArray(value) ? value : []);
      else if (key === D.KEYS.passengerLocation || key === D.KEYS.driverLocation) {
        operation = saveLocation(key === D.KEYS.passengerLocation ? 'passenger' : 'driver', value, user);
      } else if (key === D.KEYS.tracking && value?.bookingId && value.status !== 'cancelled') {
        operation = request(`/records/tracking/${encodeURIComponent(value.bookingId)}`, {
          method: 'PUT',
          body: JSON.stringify({ ...value, relatedId: value.driverId || null })
        });
      }
      if (operation) operation.catch((error) => {
        console.error('SQL API synchronization failed:', error);
        D.toast(error.message || 'تعذرت مزامنة البيانات مع SQL Server.', 'error');
        refresh().catch((refreshError) => console.error('SQL API refresh failed:', refreshError));
      });
    };
  }

  function installAuthForms() {
    D.apiAuthFormsReady = true;
    const login = document.querySelector('#loginForm');
    if (login) {
      const identifier = login.querySelector('[name="login"]');
      if (identifier) {
        identifier.type = 'email';
        identifier.autocomplete = 'username';
        identifier.placeholder = 'name@example.com';
      }
      const label = document.querySelector('label[for="login"]');
      if (label) label.textContent = 'البريد الإلكتروني';
      login.onsubmit = async (event) => {
        event.preventDefault();
        const message = document.querySelector('#authMsg');
        try {
          const result = await signIn(identifier.value.trim(), login.password.value);
          const next = new URLSearchParams(location.search).get('next');
          location.href = next ? decodeURIComponent(next) : result.role === 'driver' ? 'driver.html' : 'dashboard.html';
        } catch (error) {
          if (message) {
            message.className = 'notice error';
            message.textContent = error.message || 'تعذر تسجيل الدخول.';
          }
        }
      };
    }
    const register = document.querySelector('#registerForm');
    if (register) {
      register.onsubmit = async (event) => {
        event.preventDefault();
        const message = register.querySelector('[data-register-message]');
        const data = Object.fromEntries(new FormData(register).entries());
        data.email = String(data.email || '').trim().toLowerCase();
        data.username = String(data.username || '').trim().toLowerCase();
        data.phone = D.normalizePhone(data.phone);
        if (!data.fullName || !D.validEmail(data.email) || !D.validPhone(data.phone)
          || !/^[a-z0-9_]{3,20}$/.test(data.username) || String(data.password || '').length < 6
          || !data.gender || !data.university || !data.governorate
          || (data.role === 'driver' && (!data.vehicleType || !data.carModel
            || Number(data.carYear) < 1990 || Number(data.passengerSeats) < 1))) {
          D.toast('تحقق من الاسم واسم المستخدم وبيانات الحساب والمركبة المطلوبة.', 'error');
          return;
        }
        try {
          const result = await request('/auth/register', { method: 'POST', body: JSON.stringify(data) });
          saveSession(result);
          location.href = result.user.role === 'driver' ? 'driver.html' : 'dashboard.html';
        } catch (error) {
          if (message) {
            message.className = 'notice error';
            message.textContent = error.message || 'تعذر إنشاء الحساب.';
          } else D.toast(error.message || 'تعذر إنشاء الحساب.', 'error');
        }
      };
    }
  }

  function saveSession(result) {
    D.STORAGE.set(D.KEYS.token, result.token);
    D.setUser(result.user);
    D.STORAGE.set(D.KEYS.session, { userId: result.user.id, createdAt: new Date().toISOString() });
  }

  async function signIn(identifier, password) {
    const result = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password })
    });
    saveSession(result);
    return result.user;
  }

  async function signOut() {
    try {
      if (D.STORAGE.get(D.KEYS.token, '')) await request('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('SQL API sign-out failed:', error);
    } finally {
      D.STORAGE.remove(D.KEYS.token);
      D.STORAGE.remove(D.KEYS.session);
      D.setUser(null);
      cache(D.KEYS.notifications, []);
      clearInterval(refreshTimer);
    }
  }

  async function saveProfile(profile) {
    const saved = await request('/users/me', { method: 'PUT', body: JSON.stringify(profile) });
    D.setUser(saved);
    return saved;
  }

  async function getPublicProfile(id) { return request(`/users/${encodeURIComponent(id)}`); }
  async function getDriverRatings(id) { return request(`/users/${encodeURIComponent(id)}/ratings`); }
  async function getRatingEligibility(id) { return request(`/users/${encodeURIComponent(id)}/rating-eligibility`); }
  async function isFollowing(id) {
    const result = await request(`/users/${encodeURIComponent(id)}/following/${encodeURIComponent(D.getUser().id)}`);
    return result.following;
  }
  async function toggleFollow(id, following) {
    return request(`/users/${encodeURIComponent(id)}/following`, {
      method: 'PUT',
      body: JSON.stringify({ following })
    });
  }
  async function submitRating(rating) {
    return request('/ratings', { method: 'POST', body: JSON.stringify(rating) });
  }
  async function createBooking(booking) {
    const result = await request('/bookings', { method: 'POST', body: JSON.stringify(booking) });
    await refreshAfterMutation();
    return result;
  }
  async function reviewBooking(id, status) {
    const result = await request(`/bookings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await refreshAfterMutation();
    return result;
  }
  async function saveTrip(trip) {
    const isExisting = D.trips().some((item) => item.id === trip.id);
    const path = isExisting ? `/trips/${encodeURIComponent(trip.id)}` : '/trips';
    const result = await request(path, {
      method: isExisting ? 'PUT' : 'POST',
      body: JSON.stringify(trip)
    });
    await refreshAfterMutation();
    return result;
  }

  async function refreshAfterMutation() {
    try {
      await refresh();
    } catch (error) {
      console.error('SQL Server saved the change but the client refresh failed:', error);
      D.toast('تم حفظ البيانات، لكن تعذر تحديث العرض. أعد تحميل الصفحة.', 'error');
    }
  }
  async function openConversation(targetId, tripId) {
    return request('/conversations', {
      method: 'POST',
      body: JSON.stringify({ targetId, tripId })
    });
  }
  async function getConversation(id) { return request(`/conversations/${encodeURIComponent(id)}`); }
  function subscribeMessages(id, onMessages, onError) {
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const messages = await request(`/conversations/${encodeURIComponent(id)}/messages`);
        if (!stopped) onMessages(messages);
      } catch (error) {
        if (!stopped) onError(error);
      }
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
  async function markMessagesRead(id) {
    return request(`/conversations/${encodeURIComponent(id)}/read`, { method: 'PUT' });
  }
  async function sendMessage(id, text) {
    return request(`/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text })
    });
  }

  async function start() {
    D.apiEnabled = true;
    hookStorage();
    const scheduleFormSetup = () => setTimeout(installAuthForms, 0);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleFormSetup, { once: true });
    } else {
      scheduleFormSetup();
    }
    D.setUser(null);
    D.STORAGE.remove(D.KEYS.session);
    cache(D.KEYS.trips, []);
    cache(D.KEYS.bookings, []);
    cache(D.KEYS.users, []);
    cache(D.KEYS.notifications, []);
    cache(D.KEYS.tracking, null);
    try {
      await refresh();
    } catch (error) {
      console.error('SQL Server initialization failed:', error);
      D.toast(error.message || 'تعذر الاتصال بخادم SQL Server.', 'error');
    }
    refreshTimer = setInterval(() => {
      refresh().catch((error) => console.error('SQL Server refresh failed:', error));
    }, 5000);
  }

  window.DARB_API = {
    start,
    signIn,
    signOut,
    saveProfile,
    createBooking,
    reviewBooking,
    saveTrip,
    getPublicProfile,
    getDriverRatings,
    isFollowing,
    toggleFollow,
    getRatingEligibility,
    submitRating,
    openConversation,
    getConversation,
    subscribeMessages,
    markMessagesRead,
    sendMessage
  };
})();
