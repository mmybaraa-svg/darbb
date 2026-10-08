document.addEventListener('DOMContentLoaded', () => {
  const D = window.DARB;
  D.ready.then(() => {
    const viewer = D.requireAuth();
    if (!viewer) return;

    const params = new URLSearchParams(location.search);
    const targetId = params.get('user') || viewer.id;
    const ownProfile = targetId === viewer.id;
    const host = document.querySelector('[data-public-profile]');
    const editor = document.querySelector('[data-profile-editor]');
    const form = document.querySelector('#profileForm');
    const photoInput = document.querySelector('#profilePhoto');
    const photoImage = document.querySelector('[data-profile-image]');
    const initials = document.querySelector('[data-profile-initials]');
    const message = document.querySelector('#profileMsg');
    const ratingModal = document.querySelector('[data-rating-modal]');
    const ratingForm = document.querySelector('[data-rating-form]');
    let profile;
    let profilePhoto = '';
    let eligibleTrips = [];

    const usernameFor = (user) => {
      const base = String(user.username || user.fullName || 'darb_user')
        .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 12) || 'darb_user';
      return user.username || `${base}_${String(user.id).replace(/[^a-z0-9]/gi, '').slice(-5).toLowerCase() || 'user'}`;
    };
    const areaFor = (user) => user.role === 'driver'
      ? [user.locality, user.area, user.governorate].filter(Boolean).join('، ')
      : user.governorate || '';
    const localProfile = (id) => {
      const user = D.users().find((item) => item.id === id);
      if (user) return user;
      const trip = D.trips().find((item) => item.driverId === id);
      if (!trip) return null;
      return {
        id,
        role: 'driver',
        fullName: trip.driverName,
        username: usernameFor({ id, fullName: trip.driverName }),
        university: trip.destinationUniversity,
        governorate: trip.startGovernorate,
        area: trip.startArea,
        locality: trip.startLocality,
        vehicleType: trip.vehicleType,
        carModel: trip.carModel || trip.vehicleModel,
        carYear: trip.carYear || trip.vehicleYear,
        profilePhoto: ''
      };
    };
    const follows = () => D.STORAGE.get(D.KEYS.follows, []);
    const countsFor = (id) => {
      if (D.apiEnabled) {
        const stored = (profile?.id === id ? profile : null)
          || D.users().find((item) => item.id === id)
          || (id === viewer.id ? D.getUser() : null);
        return {
          followers: Number(stored?.followersCount || 0),
          following: Number(stored?.followingCount || 0)
        };
      }
      const relations = follows();
      return {
        followers: relations.filter((item) => item.followingId === id).length,
        following: relations.filter((item) => item.followerId === id).length
      };
    };
    const ratingList = () => D.STORAGE.get(D.KEYS.ratings, []);
    const getEligibleTrips = async () => {
      if (viewer.role !== 'passenger' || profile.role !== 'driver' || ownProfile) return [];
      if (D.apiEnabled) return window.DARB_API.getRatingEligibility(profile.id);
      return D.bookings()
        .filter((booking) => booking.passengerId === viewer.id
          && booking.driverId === profile.id
          && booking.status === 'confirmed'
          && D.STORAGE.get(D.KEYS.tracking, null)?.bookingId === booking.id
          && D.STORAGE.get(D.KEYS.tracking, null)?.status === 'completed')
        .filter((booking) => !ratingList().some((rating) => rating.tripId === booking.tripId && rating.passengerId === viewer.id))
        .map((booking) => ({ tripId: booking.tripId, bookingId: booking.id }));
    };
    const renderStars = (value) => {
      const filled = Math.round(value);
      return `<span class="review-stars" aria-label="${filled} من 5 نجوم">${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}</span>`;
    };
    const renderReviews = (ratings) => {
      if (!ratings.length) return '<div class="empty review-empty">لا توجد تقييمات بعد.</div>';
      return `<div class="review-list">${ratings.slice(0, 3).map((rating) => {
        const reviewer = D.users().find((user) => user.id === rating.passengerId);
        return `<article class="review-item"><div class="review-top"><strong>${D.escape(reviewer?.fullName || 'مستخدم دَرْب')}</strong>${renderStars(Number(rating.stars) || 0)}</div>${rating.comment ? `<p>${D.escape(rating.comment)}</p>` : '<p class="muted">تقييم دون تعليق.</p>'}<time class="muted">${D.escape(D.formatDate(String(rating.createdAt || '').slice(0, 10)))}</time></article>`;
      }).join('')}</div>`;
    };
    const setPhoto = (container, user) => {
      const source = typeof user.profilePhoto === 'string' ? user.profilePhoto : '';
      if (source && (/^https:\/\/[^\s]+$/i.test(source) || /^data:image\/(?:jpeg|png|webp);base64,/i.test(source))) {
        return `<img src="${D.escape(source)}" alt="" loading="lazy">`;
      }
      return `<span aria-hidden="true">${D.escape(user.fullName?.trim().charAt(0) || 'د')}</span>`;
    };

    async function render() {
      if (ownProfile) {
        profile = D.getUser() || viewer;
        if (D.apiEnabled) {
          const publicData = await window.DARB_API.getPublicProfile(targetId);
          if (publicData) {
            profile = {
              ...publicData,
              ...profile,
              followersCount: publicData.followersCount,
              followingCount: publicData.followingCount
            };
          }
        }
      } else {
        profile = D.apiEnabled
          ? await window.DARB_API.getPublicProfile(targetId)
          : localProfile(targetId);
      }
      if (!profile) {
        host.innerHTML = '<div class="empty"><h2>الملف غير متاح</h2><p>قد يكون الحساب غير موجود أو لا يملك ملفًا عامًا.</p></div>';
        editor.classList.add('hidden');
        return;
      }
      profile.username = usernameFor(profile);
      profilePhoto = profile.profilePhoto || '';
      const counts = countsFor(profile.id);
      const isFollowing = D.apiEnabled
        ? await window.DARB_API.isFollowing(profile.id)
        : follows().some((item) => item.followerId === viewer.id && item.followingId === profile.id);
      const ratings = profile.role === 'driver'
        ? (D.apiEnabled ? await window.DARB_API.getDriverRatings(profile.id) : ratingList().filter((rating) => rating.driverId === profile.id))
        : [];
      const average = ratings.length ? ratings.reduce((sum, rating) => sum + Number(rating.stars), 0) / ratings.length : 0;
      eligibleTrips = await getEligibleTrips();
      const chatTrip = D.bookings()
        .filter((booking) => ((booking.passengerId === viewer.id && booking.driverId === profile.id)
          || (booking.driverId === viewer.id && booking.passengerId === profile.id))
          && booking.status === 'confirmed')
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
      const roleLabel = profile.role === 'driver' ? 'سائق' : 'طالب / راكب';
      host.innerHTML = `
        <div class="profile-hero">
          <div class="profile-avatar public-avatar" data-public-avatar>${setPhoto(host, profile)}</div>
          <div class="profile-identity">
            <span class="profile-role">${D.escape(roleLabel)}</span>
            <h2>${D.escape(profile.fullName || 'مستخدم دَرْب')}</h2>
            <p class="profile-username">@${D.escape(profile.username)}</p>
            ${profile.role === 'driver' ? `<div class="rating-summary">${ratings.length ? `${renderStars(average)} <strong>${average.toFixed(1)}</strong><span class="muted">من ${ratings.length} تقييم</span>` : '<span class="muted">لا توجد تقييمات بعد</span>'}</div>` : ''}
          </div>
          <div class="profile-stats" aria-label="إحصاءات المتابعة">
            <div><strong data-followers-count>${counts.followers}</strong><span>متابع</span></div>
            <div><strong>${counts.following}</strong><span>يتابع</span></div>
          </div>
          <div class="profile-actions">
            ${ownProfile ? '<button class="btn btn-outline" type="button" data-edit-profile>تعديل الملف</button>' : `<button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}" type="button" data-follow aria-pressed="${isFollowing}">${isFollowing ? 'إلغاء المتابعة' : 'متابعة'}</button>`}
            ${!ownProfile ? `<a class="btn btn-outline ${chatTrip ? '' : 'is-disabled'}" ${chatTrip ? `href="chat.html?user=${encodeURIComponent(profile.id)}&trip=${encodeURIComponent(chatTrip.tripId)}"` : 'aria-disabled="true" title="المراسلة متاحة بعد تأكيد الحجز"'}>مراسلة</a>` : ''}
            ${!ownProfile && eligibleTrips.length ? '<button class="btn btn-soft" type="button" data-rate>تقييم السائق</button>' : ''}
          </div>
        </div>
        ${profile.bio ? `<p class="profile-bio">${D.escape(profile.bio)}</p>` : ''}
        <div class="profile-details">
          ${profile.role === 'driver' ? `<article class="profile-detail"><span>المركبة</span><strong>${D.escape([profile.vehicleType, profile.carModel, profile.carYear].filter(Boolean).join(' · ') || 'لم تتم الإضافة')}</strong></article>` : ''}
          <article class="profile-detail"><span>${profile.role === 'driver' ? 'الوجهة المعتادة' : 'الجامعة'}</span><strong>${D.escape(profile.university || 'لم تتم الإضافة')}</strong></article>
          <article class="profile-detail"><span>المنطقة العامة</span><strong>${D.escape(areaFor(profile) || 'لم تتم الإضافة')}</strong></article>
        </div>
        ${profile.role === 'driver' ? `<section class="profile-reviews"><div class="section-head"><div><h3>تقييمات الركاب</h3><p class="muted">${ratings.length ? `${ratings.length} تقييم` : 'تقييمات بعد إكمال الرحلة'}</p></div></div>${renderReviews(ratings)}</section>` : ''}
      `;
      document.querySelector('[data-profile-page-subtitle]').textContent = ownProfile
        ? 'ملفك العام ومعلومات الحساب.'
        : `الملف العام لـ ${roleLabel}.`;
      editor.classList.toggle('hidden', !ownProfile);
      if (ownProfile) fillEditor(profile);
      host.querySelector('[data-edit-profile]')?.addEventListener('click', () => editor.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      host.querySelector('[data-follow]')?.addEventListener('click', toggleFollowing);
      host.querySelector('[data-rate]')?.addEventListener('click', openRating);
    }

    function fillEditor(user) {
      Object.entries(user).forEach(([key, value]) => {
        if (form.elements.namedItem(key) && key !== 'profilePhoto') form.elements.namedItem(key).value = value ?? '';
      });
      form.elements.namedItem('username').value = usernameFor(user);
      form.elements.namedItem('bio').value = user.bio || '';
      document.querySelectorAll('[data-driver-profile]').forEach((field) => field.classList.toggle('hidden', user.role !== 'driver'));
      renderEditorPhoto();
      setTimeout(() => {
        const governorate = form.elements.namedItem('governorate');
        if (!governorate?.value) return;
        governorate.dispatchEvent(new Event('change'));
        setTimeout(() => {
          const area = form.elements.namedItem('area');
          area.value = user.area || '';
          area.dispatchEvent(new Event('change'));
          setTimeout(() => { form.elements.namedItem('locality').value = user.locality || ''; }, 0);
        }, 0);
      }, 0);
    }

    function renderEditorPhoto() {
      if (profilePhoto) {
        photoImage.src = profilePhoto;
        photoImage.classList.remove('hidden');
        initials.classList.add('hidden');
      } else {
        photoImage.removeAttribute('src');
        photoImage.classList.add('hidden');
        initials.textContent = profile?.fullName?.trim().charAt(0) || 'د';
        initials.classList.remove('hidden');
      }
    }

    async function toggleFollowing(event) {
      const button = event.currentTarget;
      const following = button.getAttribute('aria-pressed') !== 'true';
      button.disabled = true;
      button.textContent = 'جارٍ التحديث...';
      try {
        if (D.apiEnabled) {
          await window.DARB_API.toggleFollow(profile.id, following);
        } else {
          const relationships = follows();
          const existing = relationships.findIndex((item) => item.followerId === viewer.id && item.followingId === profile.id);
          if (following && existing < 0) relationships.push({ id: `f_${D.uid()}`, followerId: viewer.id, followingId: profile.id, createdAt: new Date().toISOString() });
          if (!following && existing >= 0) relationships.splice(existing, 1);
          D.STORAGE.set(D.KEYS.follows, relationships);
        }
        D.toast(following ? 'تمت متابعة المستخدم.' : 'تم إلغاء المتابعة.', 'success');
        await render();
      } catch (error) {
        D.toast(error.message || 'تعذرت معالجة المتابعة.', 'error');
        button.disabled = false;
        button.textContent = following ? 'متابعة' : 'إلغاء المتابعة';
      }
    }

    photoInput?.addEventListener('change', () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
        photoInput.value = '';
        message.className = 'notice error';
        message.textContent = 'اختر صورة JPEG أو PNG أو WebP لا تتجاوز 1 ميغابايت.';
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (typeof reader.result !== 'string') return;
        profilePhoto = reader.result;
        renderEditorPhoto();
      });
      reader.addEventListener('error', () => {
        message.className = 'notice error';
        message.textContent = 'تعذرت قراءة الصورة. حاول اختيار صورة أخرى.';
      });
      reader.readAsDataURL(file);
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const username = String(data.get('username') || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        message.className = 'notice error';
        message.textContent = 'اسم المستخدم يجب أن يكون من 3 إلى 20 حرفًا إنجليزيًا أو رقمًا أو _.';
        return;
      }
      const users = D.users();
      if (!D.apiEnabled && users.some((user) => user.id !== viewer.id && usernameFor(user) === username)) {
        message.className = 'notice error';
        message.textContent = 'اسم المستخدم مستخدم. اختاري اسمًا آخر.';
        return;
      }
      const nextUser = {
        ...viewer,
        fullName: String(data.get('fullName') || '').trim(),
        username,
        bio: String(data.get('bio') || '').trim().slice(0, 280),
        university: data.get('university'),
        governorate: data.get('governorate'),
        area: data.get('area') || '',
        locality: data.get('locality') || '',
        profilePhoto
      };
      if (viewer.role === 'driver') {
        nextUser.vehicleType = data.get('vehicleType');
        nextUser.carModel = data.get('carModel');
        nextUser.carYear = Number(data.get('carYear'));
        nextUser.passengerSeats = Number(data.get('passengerSeats'));
      }
      try {
        let savedUser = nextUser;
        if (D.apiEnabled) {
          savedUser = await window.DARB_API.saveProfile(nextUser);
        } else {
          const index = users.findIndex((user) => user.id === viewer.id);
          if (index >= 0) users[index] = nextUser;
          else users.push(nextUser);
          D.STORAGE.set(D.KEYS.users, users);
        }
        D.setUser(savedUser);
        message.className = 'notice success';
        message.textContent = 'تم حفظ الملف الشخصي.';
        await render();
      } catch (error) {
        message.className = 'notice error';
        message.textContent = error.message || 'تعذر حفظ التغييرات. حاول مجددًا.';
      }
    });

    function openRating() {
      if (!eligibleTrips.length) {
        D.toast('لا يمكنك تقييم السائق قبل إكمال رحلة مؤكدة.', 'error');
        return;
      }
      ratingForm.reset();
      ratingForm.dataset.tripId = eligibleTrips[0].tripId;
      ratingForm.dataset.bookingId = eligibleTrips[0].bookingId || '';
      document.querySelector('[data-rating-driver]').textContent = profile.fullName;
      ratingModal.classList.remove('hidden');
      ratingModal.querySelector('input[name="stars"]').focus();
    }

    document.querySelectorAll('[data-close-rating]').forEach((button) => button.addEventListener('click', () => ratingModal.classList.add('hidden')));
    ratingModal?.addEventListener('click', (event) => {
      if (event.target === ratingModal) ratingModal.classList.add('hidden');
    });
    ratingForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const stars = Number(new FormData(ratingForm).get('stars'));
      const data = {
        tripId: ratingForm.dataset.tripId,
        bookingId: ratingForm.dataset.bookingId,
        driverId: profile.id,
        stars,
        comment: ratingForm.elements.namedItem('comment').value
      };
      const submit = ratingForm.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error('اختر تقييمًا من نجمة إلى خمس نجوم.');
        if (D.apiEnabled) {
          await window.DARB_API.submitRating(data);
        } else {
          const ratings = ratingList();
          if (ratings.some((rating) => rating.tripId === data.tripId && rating.passengerId === viewer.id)) throw new Error('سبق أن قيّمت هذه الرحلة.');
          ratings.push({ id: `r_${D.uid()}`, ...data, passengerId: viewer.id, createdAt: new Date().toISOString() });
          D.STORAGE.set(D.KEYS.ratings, ratings);
        }
        D.toast('تم إرسال تقييمك.', 'success');
        ratingModal.classList.add('hidden');
        await render();
      } catch (error) {
        const feedback = document.querySelector('[data-rating-message]');
        feedback.className = 'notice error';
        feedback.textContent = error.message || 'تعذر إرسال التقييم.';
      } finally {
        submit.disabled = false;
      }
    });

    render().catch((error) => {
      console.error('Failed to load profile:', error);
      host.innerHTML = '<div class="empty"><h2>تعذر تحميل الملف الشخصي</h2><p>تحقق من الاتصال وحاول مرة أخرى.</p></div>';
    });
  });
});
