document.addEventListener('DOMContentLoaded', () => {
  const D = window.DARB;
  D.ready.then(async () => {
    const user = D.requireAuth();
    if (!user) return;
    const params = new URLSearchParams(location.search);
    const partnerId = params.get('user');
    const tripId = params.get('trip');
    const requestedConversationId = params.get('conversation');
    const host = document.querySelector('[data-chat-messages]');
    const form = document.querySelector('[data-chat-form]');
    const input = form.elements.namedItem('message');
    const submit = form.querySelector('[type="submit"]');
    const notice = document.querySelector('[data-chat-notice]');
    let conversation;
    let partner;
    let stopMessages;

    const fail = (text) => {
      notice.className = 'chat-notice notice error';
      notice.textContent = text;
      host.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'empty chat-page-error';
      empty.textContent = text;
      host.append(empty);
      input.disabled = true;
      submit.disabled = true;
    };
    const userProfile = async (id) => {
      const cached = D.users().find((item) => item.id === id);
      return D.apiEnabled ? window.DARB_API.getPublicProfile(id) : cached || null;
    };
    const initConversation = async () => {
      if (D.apiEnabled) {
        if (requestedConversationId) return window.DARB_API.getConversation(requestedConversationId);
        if (!partnerId || !tripId) throw new Error('رابط المحادثة غير مكتمل.');
        return window.DARB_API.openConversation(partnerId, tripId);
      }
      const messages = D.STORAGE.get(D.KEYS.messages, []);
      const conversations = D.STORAGE.get(D.KEYS.conversations, []);
      if (requestedConversationId) {
        const found = conversations.find((item) => item.id === requestedConversationId);
        if (!found || !Array.isArray(found.participantIds) || !found.participantIds.includes(user.id)) {
          throw new Error('المحادثة غير متاحة.');
        }
        const booking = D.bookings().find((item) => item.id === found.bookingId
          && item.tripId === found.tripId
          && item.passengerId === found.passengerId
          && item.driverId === found.driverId);
        if (!booking) throw new Error('الحجز المرتبط بالمحادثة غير متاح.');
        found.bookingStatus = booking.status;
        messages.forEach((message) => {
          if (message.conversationId === found.id && message.receiverId === user.id) message.read = true;
        });
        D.STORAGE.set(D.KEYS.messages, messages);
        return found;
      }
      if (!partnerId || !tripId || partnerId === user.id) throw new Error('رابط المحادثة غير صالح.');
      const booking = D.bookings().find((item) => item.tripId === tripId
        && item.status === 'confirmed'
        && ((item.passengerId === user.id && item.driverId === partnerId)
          || (item.driverId === user.id && item.passengerId === partnerId)));
      if (!booking) throw new Error('المراسلة متاحة بعد تأكيد الحجز بين الطرفين.');
      const id = `${tripId}_${booking.id}`;
      let found = conversations.find((item) => item.id === id);
      if (!found) {
        found = {
          id,
          tripId,
          bookingId: booking.id,
          passengerId: booking.passengerId,
          driverId: booking.driverId,
          participantIds: [booking.passengerId, booking.driverId],
          createdAt: new Date().toISOString()
        };
        conversations.push(found);
        D.STORAGE.set(D.KEYS.conversations, conversations);
      }
      found.bookingStatus = booking.status;
      messages.forEach((message) => {
        if (message.conversationId === id && message.receiverId === user.id) message.read = true;
      });
      D.STORAGE.set(D.KEYS.messages, messages);
      return found;
    };
    const formatTime = (value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ar-JO', { hour: '2-digit', minute: '2-digit' }).format(date);
    };
    const renderMessages = (messages) => {
      host.replaceChildren();
      if (!messages.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'ابدأ المحادثة برسالة متعلقة بالرحلة.';
        host.append(empty);
        return;
      }
      messages.forEach((message) => {
        const item = document.createElement('article');
        item.className = `chat-message${message.senderId === user.id ? ' mine' : ''}`;
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        bubble.textContent = String(message.text || '');
        const meta = document.createElement('div');
        meta.className = 'chat-meta';
        const time = document.createElement('time');
        time.textContent = formatTime(message.createdAt);
        meta.append(time);
        if (message.senderId === user.id) {
          const state = document.createElement('span');
          state.className = message.read ? 'chat-status-read' : '';
          state.textContent = message.read ? 'مقروءة' : 'مرسلة';
          meta.append(state);
        }
        item.append(bubble, meta);
        host.append(item);
      });
      host.scrollTop = host.scrollHeight;
    };

    try {
      conversation = await initConversation();
      if (!conversation.participantIds?.includes(user.id)) throw new Error('ليس لديك صلاحية لهذه المحادثة.');
      const otherId = conversation.participantIds.find((id) => id !== user.id);
      if (!otherId) throw new Error('بيانات المحادثة غير صالحة.');
      partner = await userProfile(otherId);
      if (!partner) throw new Error('الملف المرتبط بالمحادثة غير متاح.');
      document.querySelector('[data-chat-name]').textContent = partner.fullName || 'مستخدم دَرْب';
      document.querySelector('[data-chat-status]').textContent = 'محادثة مرتبطة بحجز مؤكد';
      const avatar = document.querySelector('[data-chat-avatar]');
      if (partner.profilePhoto && /^https:\/\/[^\s]+$/i.test(partner.profilePhoto)) {
        const image = document.createElement('img');
        image.src = partner.profilePhoto;
        image.alt = '';
        avatar.replaceChildren(image);
      } else {
        avatar.textContent = partner.fullName?.trim().charAt(0) || 'د';
      }
      const profileLink = document.querySelector('[data-chat-profile]');
      profileLink.href = `profile.html?user=${encodeURIComponent(otherId)}`;
      profileLink.classList.remove('hidden');
      if (conversation.bookingStatus !== 'confirmed') {
        notice.className = 'chat-notice notice info';
        notice.textContent = 'المحادثة للقراءة فقط ما لم يكن الحجز مؤكدًا.';
        input.disabled = true;
        submit.disabled = true;
      }

      if (D.apiEnabled) {
        stopMessages = window.DARB_API.subscribeMessages(conversation.id, (messages) => {
          renderMessages(messages);
          window.DARB_API.markMessagesRead(conversation.id).catch((error) => {
            console.error('Failed to mark chat messages as read:', error);
          });
        }, (error) => fail(error.message || 'تعذر تحميل الرسائل.'));
      } else {
        const messages = D.STORAGE.get(D.KEYS.messages, []).filter((item) => item.conversationId === conversation.id);
        renderMessages(messages);
      }
    } catch (error) {
      fail(error.message || 'تعذر فتح المحادثة.');
      return;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (text.length > 2000) {
        D.toast('الرسالة طويلة جدًا. الحد الأقصى 2000 حرف.', 'error');
        return;
      }
      submit.disabled = true;
      input.disabled = true;
      try {
        if (D.apiEnabled) {
          await window.DARB_API.sendMessage(conversation.id, text);
        } else {
          const booking = D.bookings().find((item) => item.id === conversation.bookingId);
          if (!booking || booking.status !== 'confirmed') {
            conversation.bookingStatus = booking?.status || 'unavailable';
            notice.className = 'chat-notice notice info';
            notice.textContent = 'المحادثة للقراءة فقط ما لم يكن الحجز مؤكدًا.';
            input.disabled = true;
            submit.disabled = true;
            throw new Error('المحادثة للقراءة فقط ما لم يكن الحجز مؤكدًا.');
          }
          const messages = D.STORAGE.get(D.KEYS.messages, []);
          const message = {
            id: `m_${D.uid()}`,
            conversationId: conversation.id,
            senderId: user.id,
            receiverId: partner.id,
            text,
            createdAt: new Date().toISOString(),
            read: false
          };
          messages.push(message);
          D.STORAGE.set(D.KEYS.messages, messages);
          const conversations = D.STORAGE.get(D.KEYS.conversations, []);
          const index = conversations.findIndex((item) => item.id === conversation.id);
          if (index >= 0) conversations[index].updatedAt = message.createdAt;
          D.STORAGE.set(D.KEYS.conversations, conversations);
          renderMessages(messages.filter((item) => item.conversationId === conversation.id));
        }
        input.value = '';
      } catch (error) {
        D.toast(error.message || 'تعذر إرسال الرسالة.', 'error');
      } finally {
        const readOnly = !D.apiEnabled && conversation.bookingStatus !== 'confirmed';
        input.disabled = readOnly;
        submit.disabled = readOnly;
        if (!readOnly) input.focus();
      }
    });

    window.addEventListener('beforeunload', () => {
      if (typeof stopMessages === 'function') stopMessages();
    });
  });
});
