(function () {
  'use strict';

  const D = window.DARB;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SPEED_KMH = 30;
  const STEP_MS = 5000;
  const validLocation = (location) => location
    && Number.isFinite(Number(location.latitude))
    && Number.isFinite(Number(location.longitude))
    && Math.abs(Number(location.latitude)) <= 90
    && Math.abs(Number(location.longitude)) <= 180;
  const haversine = (a, b) => {
    const radians = (degree) => degree * Math.PI / 180;
    const dLat = radians(Number(b.latitude) - Number(a.latitude));
    const dLng = radians(Number(b.longitude) - Number(a.longitude));
    const lat1 = radians(Number(a.latitude));
    const lat2 = radians(Number(b.latitude));
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  const escape = (value) => D.escape(value ?? '—');
  let timer = null;
  let selectedTripId = null;
  const onlineMaps = new WeakMap();

  function onlineMapFor(container) {
    const element = container?.querySelector('[data-online-map]');
    if (!element || !window.L) return null;
    if (onlineMaps.has(element)) return onlineMaps.get(element);

    const map = window.L.map(element, { zoomControl: true }).setView([31.95, 35.91], 7);
    const markers = window.L.layerGroup().addTo(map);
    const routes = window.L.layerGroup().addTo(map);
    const onlineMap = { map, markers, routes, loadedTiles: 0 };
    onlineMaps.set(element, onlineMap);
    const tiles = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    tiles.on('tileload', () => {
      onlineMap.loadedTiles += 1;
      container.classList.add('has-online-map');
    });
    tiles.on('tileerror', () => {
      if (!onlineMap.loadedTiles) container.classList.remove('has-online-map');
    });
    tiles.addTo(map);
    return onlineMap;
  }

  function leafletIcon(type, glyph) {
    return window.L.divIcon({
      className: '',
      html: `<span class="online-map-marker ${type}">${glyph}</span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  function updateOnlineMap(container, { points = [], paths = [], fit = true } = {}) {
    const onlineMap = onlineMapFor(container);
    if (!onlineMap) return false;
    const { map, markers, routes } = onlineMap;
    markers.clearLayers();
    routes.clearLayers();
    const bounds = [];

    points.forEach(({ location, type, glyph, label, trip }) => {
      if (!validLocation(location)) return;
      const latLng = [Number(location.latitude), Number(location.longitude)];
      bounds.push(latLng);
      const marker = window.L.marker(latLng, {
        icon: leafletIcon(type, glyph),
        title: label,
        keyboard: true
      }).addTo(markers);
      if (trip) {
        marker.bindPopup(`<strong>${escape(trip.driverName)}</strong><br>${escape(trip.destinationUniversity)}<br>${escape(trip.vehicleType)} · ${escape(trip.carModel)}<br>${Number(trip.availableSeats)} مقاعد · ${D.formatPrice(trip.price)}`);
        marker.on('click', () => {
          selectedTripId = trip.id;
          document.querySelectorAll('[data-nearby-trip]').forEach((card) => {
            card.classList.toggle('is-selected', card.dataset.nearbyTrip === trip.id);
          });
          [...document.querySelectorAll('[data-nearby-trip]')]
            .find((card) => card.dataset.nearbyTrip === trip.id)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      } else {
        marker.bindPopup(escape(label));
      }
    });

    paths.forEach((path) => {
      if (!path.every(validLocation)) return;
      const latLngs = path.map((point) => [Number(point.latitude), Number(point.longitude)]);
      window.L.polyline(latLngs, { color: '#168A83', weight: 5, opacity: 0.85, dashArray: '9 8' }).addTo(routes);
    });

    if (fit && bounds.length) {
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 });
    } else if (!bounds.length && map.getZoom() < 7) {
      map.setView([31.95, 35.91], 7);
    }
    window.requestAnimationFrame(() => map.invalidateSize({ pan: false }));
    return true;
  }

  function driverLocationFor(trip) {
    if (validLocation(trip.driverLocation)
      && (!trip.driverLocation.driverId || trip.driverLocation.driverId === trip.driverId)) {
      return trip.driverLocation;
    }
    const location = D.STORAGE.get(D.KEYS.driverLocation, null);
    return validLocation(location) && location.driverId === trip.driverId ? location : null;
  }

  function activeTrips() {
    return D.trips().filter((trip) => trip.status === 'open' && Number(trip.availableSeats) > 0);
  }

  function locations() {
    const passenger = D.STORAGE.get(D.KEYS.passengerLocation, null);
    return activeTrips().map((trip) => {
      const driver = driverLocationFor(trip);
      return { trip, driver, distance: validLocation(passenger) && validLocation(driver)
        ? haversine(passenger, driver)
        : null };
    });
  }

  function formatDistance(distance) {
    return distance < 10 ? `${distance.toFixed(1)} كم` : `${Math.round(distance)} كم`;
  }

  function appendMarker(group, x, y, type, glyph, label, tripId) {
    const marker = document.createElementNS(SVG_NS, 'g');
    marker.setAttribute('class', `map-marker ${type}`);
    marker.setAttribute('transform', `translate(${x} ${y})`);
    marker.setAttribute('role', 'button');
    marker.setAttribute('tabindex', '0');
    marker.setAttribute('aria-label', label);
    if (tripId) marker.dataset.tripId = tripId;
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', '16');
    marker.append(circle);
    const icon = document.createElementNS(SVG_NS, 'text');
    icon.setAttribute('class', 'marker-glyph');
    icon.setAttribute('y', '1');
    icon.textContent = glyph;
    marker.append(icon);
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('y', '-23');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = label;
    marker.append(text);
    group.append(marker);
  }

  function mapProjection(points) {
    const latitudes = points.map((point) => Number(point.latitude));
    const longitudes = points.map((point) => Number(point.longitude));
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    const latSpan = Math.max(maxLat - minLat, 0.001);
    const lngSpan = Math.max(maxLng - minLng, 0.001);
    return (point) => ({
      x: lngSpan <= 0.001 ? 400 : 70 + ((Number(point.longitude) - minLng) / lngSpan) * 660,
      y: latSpan <= 0.001 ? 210 : 70 + ((maxLat - Number(point.latitude)) / latSpan) * 280
    });
  }

  function renderNearbyMap(entries) {
    const map = document.querySelector('[data-passenger-map]');
    if (!map) return;
    const markerGroup = map.querySelector('[data-map-markers]');
    const routeGroup = map.querySelector('[data-map-routes]');
    const empty = map.querySelector('[data-map-empty]');
    markerGroup.replaceChildren();
    routeGroup.replaceChildren();

    const passenger = D.STORAGE.get(D.KEYS.passengerLocation, null);
    const mapped = entries.filter((entry) => validLocation(entry.driver));
    updateOnlineMap(map, {
      points: [
        ...mapped.map(({ trip, driver }) => ({
          location: driver,
          type: 'vehicle',
          glyph: 'د',
          label: trip.driverName || 'سائق',
          trip
        })),
        ...(validLocation(passenger) ? [{ location: passenger, type: 'passenger', glyph: 'ط', label: 'موقعك' }] : [])
      ],
      paths: validLocation(passenger) ? mapped.map(({ driver }) => [driver, passenger]) : []
    });
    const points = mapped.map((entry) => entry.driver);
    if (validLocation(passenger)) points.push(passenger);
    if (!points.length) {
      empty.textContent = 'حدّد موقعك والسائقين لعرض المواقع على المخطط';
      return;
    }
    empty.textContent = '';
    const project = mapProjection(points);
    mapped.forEach(({ trip, driver }) => {
      const position = project(driver);
      if (validLocation(passenger)) {
        const passengerPosition = project(passenger);
        const route = document.createElementNS(SVG_NS, 'path');
        route.setAttribute('class', 'map-route');
        route.setAttribute('d', `M ${position.x} ${position.y} L ${passengerPosition.x} ${passengerPosition.y}`);
        routeGroup.append(route);
      }
      appendMarker(markerGroup, position.x, position.y, 'vehicle', 'د', trip.driverName || 'سائق', trip.id);
    });
    if (validLocation(passenger)) {
      const position = project(passenger);
      appendMarker(markerGroup, position.x, position.y, 'passenger', 'ط', 'أنت');
    }
  }

  function renderNearbyList() {
    const list = document.querySelector('[data-nearby-list]');
    if (!list) return;
    const university = document.querySelector('#nearbyUniversity').value;
    const radius = Number(document.querySelector('#nearbyRadius').value) || null;
    const order = document.querySelector('#nearbySort').value;
    const time = document.querySelector('#nearbyTime').value;
    const manualArea = D.STORAGE.get(D.KEYS.passengerArea, {});
    let entries = locations().filter(({ trip, distance }) => (!university || trip.destinationUniversity === university)
      && (!radius || (distance !== null && distance <= radius))
      && (!manualArea.governorate || trip.startGovernorate === manualArea.governorate)
      && (!manualArea.area || trip.startArea === manualArea.area)
      && (!manualArea.locality || trip.startLocality === manualArea.locality));
    if (order === 'lowest') entries.sort((a, b) => a.trip.price - b.trip.price);
    else if (order === 'highest') entries.sort((a, b) => b.trip.price - a.trip.price);
    else entries.sort((a, b) => {
      if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
      if (a.distance !== null) return -1;
      if (b.distance !== null) return 1;
      return `${a.trip.departureDate}${a.trip.departureTime}`.localeCompare(`${b.trip.departureDate}${b.trip.departureTime}`);
    });
    if (time === 'soon') entries.sort((a, b) => `${a.trip.departureDate}${a.trip.departureTime}`.localeCompare(`${b.trip.departureDate}${b.trip.departureTime}`));
    renderNearbyMap(entries);
    const status = document.querySelector('[data-map-status]');
    const hasPassengerLocation = validLocation(D.STORAGE.get(D.KEYS.passengerLocation, null));
    status.textContent = manualArea.governorate || manualArea.area || manualArea.locality
      ? 'تم اختيار منطقة انطلاق يدويًا. لا تتوفر إحداثيات موثوقة لحساب المسافة.'
      : hasPassengerLocation
        ? 'المسافات تقريبية ومحسوبة بين مواقع GPS المحفوظة للسائق والراكب.'
        : 'لم نتمكن من تحديد موقعك. يمكنك السماح بالموقع أو اختيار منطقة يدويًا؛ لن نحسب مسافة دون إحداثيات.';
    if (!entries.length) {
      list.innerHTML = '<div class="empty"><h3>لا توجد سيارات قريبة حاليًا</h3><p>لم نجد رحلات مطابقة من السائقين الذين شاركوا موقعهم.</p><a class="btn btn-outline" href="trips.html">استعراض جميع الرحلات</a></div>';
      return;
    }
    list.innerHTML = entries.map(({ trip, distance }) => `<article class="nearby-card${trip.id === selectedTripId ? ' is-selected' : ''}" data-nearby-trip="${escape(trip.id)}">
      <h4>${escape(trip.driverName)}</h4>
      <p>${escape(trip.vehicleType)} · ${escape(trip.carModel)} · ${escape(trip.vehicleYear)}</p>
      <p>${escape(trip.destinationUniversity)}</p>
      <p>${escape(trip.startGovernorate)} · ${escape(trip.startArea)} · ${escape(trip.startLocality)}</p>
      <p>${distance === null ? 'المسافة غير متاحة — لم يشارك السائق موقعه' : `تبعد عنك تقريبًا ${formatDistance(distance)}`}</p>
      <p>${Number(trip.availableSeats)} مقاعد متاحة · ${escape(trip.departureTime)} · ${D.formatPrice(trip.price)}</p>
      <div class="actions">
        <a class="btn btn-outline" href="trip-details.html?id=${encodeURIComponent(trip.id)}">عرض الرحلة</a>
        <button class="btn btn-primary" type="button" data-nearby-book="${escape(trip.id)}">احجز الآن</button>
      </div>
    </article>`).join('');
  }

  function populateFilters() {
    const trips = activeTrips();
    const university = document.querySelector('#nearbyUniversity');
    const currentUniversity = university.value;
    const universities = window.DARB_TRIPS?.universities
      || [...new Set(trips.map((trip) => trip.destinationUniversity).filter(Boolean))].sort();
    university.innerHTML = '<option value="">جميع الجامعات</option>'
      + universities.map((name) => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
    if (universities.includes(currentUniversity)) university.value = currentUniversity;

    refreshManualFilters(trips);
  }

  function refreshManualFilters(trips) {
    const saved = D.STORAGE.get(D.KEYS.passengerArea, {});
    const governorates = document.querySelector('#nearbyGovernorate');
    const areas = document.querySelector('#nearbyArea');
    const localities = document.querySelector('#nearbyManual');
    const governorateNames = [...new Set(trips.map((trip) => trip.startGovernorate).filter(Boolean))].sort();
    governorates.innerHTML = '<option value="">كل المحافظات</option>'
      + governorateNames.map((name) => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
    governorates.value = governorateNames.includes(saved.governorate) ? saved.governorate : '';
    const areaNames = [...new Set(trips
      .filter((trip) => !governorates.value || trip.startGovernorate === governorates.value)
      .map((trip) => trip.startArea).filter(Boolean))].sort();
    areas.innerHTML = '<option value="">كل المناطق</option>'
      + areaNames.map((name) => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
    areas.value = areaNames.includes(saved.area) ? saved.area : '';
    const localityNames = [...new Set(trips
      .filter((trip) => (!governorates.value || trip.startGovernorate === governorates.value)
        && (!areas.value || trip.startArea === areas.value))
      .map((trip) => trip.startLocality).filter(Boolean))].sort();
    localities.innerHTML = '<option value="">كل التجمعات</option>'
      + localityNames.map((name) => `<option value="${escape(name)}">${escape(name)}</option>`).join('');
    localities.value = localityNames.includes(saved.locality) ? saved.locality : '';
    D.STORAGE.set(D.KEYS.passengerArea, {
      governorate: governorates.value,
      area: areas.value,
      locality: localities.value
    });
  }

  function bookingFor(user) {
    const trips = D.trips();
    return D.bookings().filter((booking) => booking.passengerId === user.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((booking) => ({ booking, trip: trips.find((trip) => trip.id === booking.tripId) }))
      .filter((item) => item.trip);
  }

  function stageIndex(status) {
    return ({ confirmed: 0, approaching: 1, arrived: 2, picked_up: 3, to_university: 4, completed: 5 })[status] ?? -1;
  }

  function renderTracking(user) {
    const panel = document.querySelector('[data-tracking-panel]');
    const bookings = bookingFor(user);
    const selected = bookings.find(({ booking }) => booking.status === 'confirmed')
      || bookings.find(({ booking, trip }) => booking.status === 'cancelled' || trip.status === 'cancelled');
    if (!selected) {
      panel.classList.add('hidden');
      stopSimulation();
      return;
    }
    panel.classList.remove('hidden');
    const { booking, trip } = selected;
    const state = D.STORAGE.get(D.KEYS.tracking, null);
    const passenger = D.STORAGE.get(D.KEYS.passengerLocation, null);
    const driver = driverLocationFor(trip);
    const cancelled = booking.status === 'cancelled' || trip.status === 'cancelled';
    let tracking = state && state.bookingId === booking.id ? state : null;
    if (cancelled) {
      stopSimulation();
      tracking = { ...(tracking || {}), tripId: trip.id, bookingId: booking.id, status: 'cancelled' };
    } else if (!tracking && validLocation(passenger) && validLocation(driver)) {
      tracking = {
        tripId: trip.id,
        bookingId: booking.id,
        passengerId: user.id,
        driverId: trip.driverId,
        status: 'approaching',
        startLatitude: Number(driver.latitude),
        startLongitude: Number(driver.longitude),
        targetLatitude: Number(passenger.latitude),
        targetLongitude: Number(passenger.longitude),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      D.STORAGE.set(D.KEYS.tracking, tracking);
    }
    if (tracking) D.STORAGE.set(D.KEYS.tracking, tracking);
    document.querySelector('[data-tracking-subtitle]').textContent = `${trip.destinationUniversity} · ${D.formatDate(trip.departureDate)} · ${trip.departureTime}`;
    document.querySelector('[data-tracking-badge]').textContent = cancelled ? 'تم إلغاء الحجز' : 'حجز مؤكد';
    document.querySelector('[data-tracking-badge]').className = `badge ${cancelled ? 'cancelled' : 'confirmed'}`;
    const startButton = document.querySelector('[data-start-university]');
    const pickupButton = document.querySelector('[data-pickup-confirm]');
    const completeButton = document.querySelector('[data-complete-trip]');
    pickupButton.classList.toggle('hidden', !tracking || tracking.status !== 'arrived');
    startButton.classList.toggle('hidden', !tracking || tracking.status !== 'picked_up');
    completeButton.classList.toggle('hidden', !tracking || tracking.status !== 'to_university');
    updateTimeline(tracking?.status || 'confirmed');

    if (cancelled) {
      document.querySelector('[data-tracking-eta]').textContent = '—';
      document.querySelector('[data-tracking-distance]').textContent = '';
      document.querySelector('[data-tracking-status]').textContent = 'تم إلغاء الرحلة؛ التتبع متوقف.';
      drawTracking(null, null, null);
      stopSimulation();
      return;
    }
    if (booking.status !== 'confirmed') return;
    if (!validLocation(passenger) || !validLocation(driver)) {
      document.querySelector('[data-tracking-eta]').textContent = 'غير متاح';
      document.querySelector('[data-tracking-distance]').textContent = '';
      document.querySelector('[data-tracking-status]').textContent = !validLocation(passenger)
        ? 'حدّد موقعك لبدء محاكاة الاقتراب. لا تتم مشاركة موقعك دون إذنك.'
        : 'لم يشارك السائق موقعه بعد؛ لن يبدأ التتبع حتى يحدّث موقعه.';
      drawTracking(passenger, driver, null);
      stopSimulation();
      return;
    }
    if (!tracking) return;
    const vehicle = simulatedVehicle(tracking);
    const distance = haversine(vehicle, passenger);
    const eta = Math.ceil((distance / SPEED_KMH) * 60);
    document.querySelector('[data-eta-label]').textContent = tracking.status === 'to_university' ? 'الوجهة' : 'الوقت المتوقع للوصول';
    document.querySelector('[data-tracking-eta]').textContent = tracking.status === 'arrived'
      ? 'السيارة وصلت'
      : tracking.status === 'picked_up'
        ? 'تم الصعود'
      : tracking.status === 'to_university'
        ? 'في الطريق'
        : tracking.status === 'completed'
          ? 'اكتملت الرحلة'
          : `${eta} دقيقة`;
    document.querySelector('[data-tracking-distance]').textContent = tracking.status === 'to_university'
      ? trip.destinationUniversity
      : `تبعد تقريبًا ${formatDistance(distance)} · سرعة تقديرية ${SPEED_KMH} كم/ساعة`;
    document.querySelector('[data-tracking-status]').textContent = tracking.status === 'to_university'
      ? 'بدأت الرحلة إلى الجامعة. موقع السيارة والجامعة غير معروض لعدم توفر إحداثيات موثوقة.'
      : tracking.status === 'completed'
        ? 'اكتملت الرحلة حسب المحاكاة التجريبية.'
        : tracking.status === 'picked_up'
          ? 'تم الصعود إلى السيارة. اضغط لبدء محاكاة الرحلة إلى الجامعة.'
        : `محاكاة موقع السيارة على مسار توضيحي — آخر تحديث ${new Date(tracking.updatedAt || tracking.startedAt).toLocaleTimeString('ar-JO')}.`;
    drawTracking(passenger, tracking.status === 'to_university' || tracking.status === 'completed' ? null : driver, tracking.status === 'to_university' || tracking.status === 'completed' ? null : vehicle);
    if (tracking.status === 'approaching') startSimulation(user, booking, tracking, passenger);
    else stopSimulation();
  }

  function updateTimeline(status) {
    const index = stageIndex(status);
    document.querySelectorAll('[data-tracking-timeline] [data-stage]').forEach((item, i) => {
      item.classList.toggle('done', index >= 0 && i < index);
      item.classList.toggle('active', i === index);
      item.classList.toggle('cancelled', status === 'cancelled' && i === 0);
    });
  }

  function simulatedVehicle(tracking) {
    if (tracking.status !== 'approaching') {
      return { latitude: tracking.targetLatitude, longitude: tracking.targetLongitude };
    }
    const durationMs = Math.max(60_000, haversine(
      { latitude: tracking.startLatitude, longitude: tracking.startLongitude },
      { latitude: tracking.targetLatitude, longitude: tracking.targetLongitude }
    ) / SPEED_KMH * 3_600_000);
    const elapsed = Math.max(0, Date.now() - new Date(tracking.startedAt).getTime());
    const progress = Math.min(1, elapsed / durationMs);
    if (progress >= 1) {
      tracking.status = 'arrived';
      tracking.updatedAt = new Date().toISOString();
      D.STORAGE.set(D.KEYS.tracking, tracking);
      updateTimeline('arrived');
      document.querySelector('[data-start-university]').classList.remove('hidden');
    }
    return {
      latitude: tracking.startLatitude + (tracking.targetLatitude - tracking.startLatitude) * progress,
      longitude: tracking.startLongitude + (tracking.targetLongitude - tracking.startLongitude) * progress
    };
  }

  function drawTracking(passenger, driver, vehicle) {
    const map = document.querySelector('[data-tracking-map]');
    const markers = map.querySelector('[data-tracking-markers]');
    const routes = map.querySelector('[data-tracking-route]');
    markers.replaceChildren();
    routes.replaceChildren();
    const points = [passenger, vehicle].filter(validLocation);
    updateOnlineMap(map, {
      points: [
        ...(validLocation(vehicle) ? [{ location: vehicle, type: 'vehicle', glyph: 'د', label: 'السيارة' }] : []),
        ...(validLocation(passenger) ? [{ location: passenger, type: 'passenger', glyph: 'ط', label: 'موقعك' }] : [])
      ],
      paths: validLocation(passenger) && validLocation(vehicle) ? [[vehicle, passenger]] : []
    });
    if (!points.length) return;
    const project = mapProjection(points);
    if (validLocation(passenger) && validLocation(vehicle)) {
      const from = project(vehicle);
      const to = project(passenger);
      const route = document.createElementNS(SVG_NS, 'path');
      route.setAttribute('class', 'map-route');
      route.setAttribute('d', `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
      routes.append(route);
    }
    if (validLocation(vehicle)) {
      const point = project(vehicle);
      appendMarker(markers, point.x, point.y, 'vehicle', 'د', 'السيارة');
    }
    if (validLocation(passenger)) {
      const point = project(passenger);
      appendMarker(markers, point.x, point.y, 'passenger', 'ط', 'أنت');
    }
  }

  function startSimulation(user, booking, tracking, passenger) {
    if (timer) return;
    timer = window.setInterval(() => {
      const latest = D.STORAGE.get(D.KEYS.tracking, null);
      if (!latest || latest.bookingId !== booking.id || latest.status !== 'approaching') {
        stopSimulation();
        renderTracking(user);
        return;
      }
      latest.updatedAt = new Date().toISOString();
      D.STORAGE.set(D.KEYS.tracking, latest);
      renderTracking(user);
    }, STEP_MS);
  }

  function stopSimulation() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function renderDashboard() {
    const user = D.requireAuth('passenger');
    if (!user || !document.querySelector('[data-passenger-map]')) return;
    populateFilters();
    renderNearbyList();
    renderTracking(user);
  }

  function renderDriverMap() {
    const map = document.querySelector('[data-driver-map]');
    if (!map) return;
    const user = D.requireAuth('driver');
    if (!user) return;
    const markers = map.querySelector('[data-map-markers]');
    markers.replaceChildren();
    const location = D.STORAGE.get(D.KEYS.driverLocation, null);
    const status = document.querySelector('[data-driver-map-status]');
    updateOnlineMap(map, {
      points: validLocation(location) && location.driverId === user.id
        ? [{ location, type: 'vehicle', glyph: 'د', label: 'موقع رحلتي' }]
        : [],
      fit: validLocation(location) && location.driverId === user.id
    });
    if (!validLocation(location) || location.driverId !== user.id) {
      status.textContent = 'حدّث موقعك باستخدام زر GPS الموجود في هذه الصفحة لعرضه على المخطط.';
      return;
    }
    const position = mapProjection([location])(location);
    appendMarker(markers, position.x, position.y, 'vehicle', 'د', 'موقعك');
    status.textContent = `آخر موقع محفوظ لهذا الجهاز: ${new Date(location.timestamp).toLocaleString('ar-JO')}. لا يتم إرسال تحديثات تلقائية.`;
  }

  function handleActions(event) {
    const book = event.target.closest('[data-nearby-book]');
    if (book && window.DARB_TRIPS) {
      window.DARB_TRIPS.book(book.dataset.nearbyBook);
      window.setTimeout(renderDashboard, 0);
    }
    const marker = event.target.closest('[data-trip-id]');
    if (marker) {
      selectedTripId = marker.dataset.tripId;
      [...document.querySelectorAll('[data-nearby-trip]')]
        .find((card) => card.dataset.nearbyTrip === selectedTripId)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      document.querySelectorAll('[data-nearby-trip]').forEach((card) => {
        card.classList.toggle('is-selected', card.dataset.nearbyTrip === selectedTripId);
      });
    }
    if (event.target.closest('[data-pickup-confirm]')
      || event.target.closest('[data-start-university]')
      || event.target.closest('[data-complete-trip]')) {
      const state = D.STORAGE.get(D.KEYS.tracking, null);
      const action = event.target.closest('[data-pickup-confirm]') ? 'pickup'
        : event.target.closest('[data-start-university]') ? 'start' : 'complete';
      const canTransition = (action === 'pickup' && state?.status === 'arrived')
        || (action === 'start' && state?.status === 'picked_up')
        || (action === 'complete' && state?.status === 'to_university');
      if (canTransition) {
        state.status = action === 'pickup' ? 'picked_up' : action === 'start' ? 'to_university' : 'completed';
        state.updatedAt = new Date().toISOString();
        D.STORAGE.set(D.KEYS.tracking, state);
        renderDashboard();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('[data-passenger-map]')) {
      ['nearbyUniversity', 'nearbyRadius', 'nearbySort', 'nearbyTime', 'nearbyGovernorate', 'nearbyArea', 'nearbyManual'].forEach((id) => {
        document.getElementById(id).addEventListener('change', () => {
          if (id === 'nearbyGovernorate') D.STORAGE.set(D.KEYS.passengerArea, { governorate: document.getElementById(id).value, area: '', locality: '' });
          if (id === 'nearbyArea') D.STORAGE.set(D.KEYS.passengerArea, {
            governorate: document.getElementById('nearbyGovernorate').value,
            area: document.getElementById(id).value,
            locality: ''
          });
          if (id === 'nearbyManual') D.STORAGE.set(D.KEYS.passengerArea, {
            ...D.STORAGE.get(D.KEYS.passengerArea, {}),
            locality: document.getElementById(id).value
          });
          if (id === 'nearbyGovernorate' || id === 'nearbyArea') refreshManualFilters(activeTrips());
          renderNearbyList();
        });
      });
      document.addEventListener('click', handleActions);
      renderDashboard();
      window.addEventListener('darb:location-updated', (event) => {
        if (event.detail?.kind === 'passenger') {
          D.STORAGE.set(D.KEYS.passengerArea, { governorate: '', area: '', locality: '' });
          refreshManualFilters(activeTrips());
        }
        renderDashboard();
      });
      window.addEventListener('storage', renderDashboard);
      window.addEventListener('pagehide', stopSimulation, { once: true });
    }
    if (document.querySelector('[data-driver-map]')) {
      renderDriverMap();
      window.addEventListener('darb:location-updated', renderDriverMap);
      window.addEventListener('storage', renderDriverMap);
    }
  });

  window.DARB_MAP = { haversine };
})();
