(function(){'use strict';const D=window.DARB;const universities=[['الجامعة الأردنية','public'],['جامعة اليرموك','public'],['جامعة مؤتة','public'],['جامعة العلوم والتكنولوجيا الأردنية','public'],['الجامعة الهاشمية','public'],['جامعة آل البيت','public'],['جامعة البلقاء التطبيقية','public'],['جامعة الحسين بن طلال','public'],['جامعة الطفيلة التقنية','public'],['الجامعة الألمانية الأردنية','public'],['جامعة عمان العربية','private'],['جامعة الشرق الأوسط','private'],['جامعة جدارا','private'],['جامعة عمان الأهلية الخاصة','private'],['جامعة العلوم التطبيقية الخاصة','private'],['جامعة فيلادلفيا الخاصة','private'],['جامعة الإسراء','private'],['جامعة البترا','private'],['جامعة الزيتونة الأردنية الخاصة','private'],['جامعة الزرقاء','private'],['جامعة جرش','private'],['جامعة إربد الأهلية','private'],['جامعة عجلون الوطنية','private'],['جامعة العقبة للتكنولوجيا','private'],['جامعة العقبة للعلوم الطبية','private'],['جامعة العلوم الإسلامية العالمية','special-law'],['جامعة الحسين التقنية','special-law'],['الجامعة العربية المفتوحة','regional']];
const locations={"عمّان":{"لواء قصبة عمّان":["عمّان"],"لواء ماركا":["ماركا","النصر"],"لواء القويسمة":["القويسمة","الجويدة","أم الحيران"],"لواء الجامعة":["الجامعة","الجبيهة","صويلح"],"لواء وادي السير":["وادي السير","بيادر وادي السير"],"لواء سحاب":["سحاب"],"لواء الجيزة":["الجيزة","أم الرصاص"],"لواء الموقر":["الموقر","رجم الشامي"],"لواء ناعور":["ناعور","حسبان"]},"إربد":{"لواء قصبة إربد":["إربد","الحصن","بني عبيد"],"لواء الكورة":["دير أبي سعيد","جديتا","كفر الماء"],"لواء بني كنانة":["سموع","سما الروسان","يبلا"],"لواء الرمثا":["الرمثا","الطرة"],"لواء الطيبة":["الطيبة","صما"],"لواء الوسطية":["كفر أسد","حوفا"],"لواء الأغوار الشمالية":["الشونة الشمالية","وادي الريان"]},"الزرقاء":{"لواء قصبة الزرقاء":["الزرقاء"],"لواء الرصيفة":["الرصيفة"],"لواء الهاشمية":["الهاشمية"],"لواء المفرق":["الظليل","بيرين","الأزرق"]},"البلقاء":{"لواء قصبة السلط":["السلط","العارضة"],"لواء الشونة الجنوبية":["الشونة الجنوبية"],"لواء دير علا":["دير علا"],"لواء عين الباشا":["عين الباشا"],"لواء ماحص والفحيص":["الفحيص","ماحص"]},"المفرق":{"لواء قصبة المفرق":["المفرق"],"لواء البادية الشمالية":["الصالحية","رحاب"],"لواء البادية الشمالية الغربية":["الخالدية","حوشا"],"لواء الرويشد":["الرويشد"]},"جرش":{"لواء قصبة جرش":["جرش","ساكب","برما"]},"عجلون":{"لواء قصبة عجلون":["عجلون","صخرة","عرجان"],"لواء كفرنجة":["كفرنجة"]},"مأدبا":{"لواء قصبة مأدبا":["مأدبا","جرينة"],"لواء ذيبان":["ذيبان"]},"الكرك":{"لواء قصبة الكرك":["الكرك","الثنية"],"لواء المزار الجنوبي":["المزار الجنوبي"],"لواء القصر":["القصر"],"لواء الأغوار الجنوبية":["غور الصافي"]},"الطفيلة":{"لواء قصبة الطفيلة":["الطفيلة"],"لواء بصيرا":["بصيرا"],"لواء الحسا":["الحسا"]},"معان":{"لواء قصبة معان":["معان"],"لواء البتراء":["وادي موسى"],"لواء الشوبك":["الشوبك"],"لواء الحسينية":["الحسينية"]},"العقبة":{"لواء قصبة العقبة":["العقبة"],"لواء القويرة":["القويرة","الديسة","وادي عربة"]}};
function fillUniversities(){const s=document.querySelectorAll('[data-university-select]');s.forEach(sel=>{sel.innerHTML='<option value="">اختر الجامعة</option>'+universities.map(x=>`<option value="${D.escape(x[0])}">${D.escape(x[0])} — ${x[1]==='public'?'رسمية':'خاصة'}</option>`).join('')})}function setupLocations(){document.querySelectorAll('[data-governorate]').forEach(g=>{const a=document.querySelector(`[data-area="${g.dataset.forTarget}"]`),l=document.querySelector(`[data-locality="${g.dataset.forTarget}"]`);if(!a||!l)return;g.innerHTML='<option value="">اختر المحافظة</option>'+Object.keys(locations).map(x=>`<option>${x}</option>`).join('');g.onchange=()=>{a.innerHTML='<option value="">اختر اللواء/المنطقة</option>';l.innerHTML='<option value="">اختر التجمع/المحلية</option>';Object.keys(locations[g.value]||{}).forEach(x=>a.insertAdjacentHTML('beforeend',`<option>${x}</option>`))};a.onchange=()=>{l.innerHTML='<option value="">اختر التجمع/المحلية</option>';Object.values(locations[g.value]||{}).find((_,i)=>Object.keys(locations[g.value]||{})[i]===a.value)?.forEach(x=>l.insertAdjacentHTML('beforeend',`<option>${x}</option>`))}})}
function toggleDriver(){const driver=document.querySelector('input[name="role"][value="driver"]:checked');document.querySelectorAll('[data-driver-fields]').forEach(x=>x.classList.toggle('hidden',!driver))}function role(){document.querySelectorAll('input[name="role"]').forEach(x=>x.onchange=toggleDriver);toggleDriver()}
function login(){
 const f=document.querySelector('#loginForm');
 if(!f || f.dataset.apiBound)return;
 f.dataset.apiBound='1';
 f.addEventListener('submit',async e=>{
  e.preventDefault();
  const identifier=f.elements.login.value.trim();
  const password=f.elements.password.value;
  const msg=document.querySelector('#authMsg')||(()=>{
   const x=document.createElement('div');x.id='authMsg';x.className='notice hidden';f.prepend(x);return x;
  })();
  const show=(t,ok=false)=>{msg.textContent=t;msg.classList.remove('hidden','info','success','error');msg.classList.add(ok?'success':'error');};
  const btn=f.querySelector('button[type="submit"],button:not([type])');
  if(btn){btn.disabled=true;btn.textContent='جارٍ تسجيل الدخول...';}
  try{
   const id=/^0?7\d{8}$/.test(identifier.replace(/[\s-]/g,''))?
    '+962'+identifier.replace(/[\s-]/g,'').replace(/^0/,''):identifier;
   const response=await fetch('http://localhost:5000/api/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},
    body:JSON.stringify({identifier:id,password})
   });
   const data=await response.json();
   if(!response.ok)throw new Error(response.status===401?'رقم الهاتف أو البريد الإلكتروني أو كلمة المرور غير صحيحة.':'تعذر تسجيل الدخول. تأكد من تشغيل الخادم وحاول مجددًا.');
   localStorage.setItem('darb_current_user',JSON.stringify(data.user));
   localStorage.setItem('darb_session',data.token);
   localStorage.setItem('darb_users_session',data.token);
   location.href=data.user.role==='driver'?'driver.html':'dashboard.html';
  }catch(err){show(err.message||'تعذر الاتصال بالخادم.');}
  finally{if(btn){btn.disabled=false;btn.textContent='تسجيل الدخول';}}
 });
}
function register(){
 const f=document.querySelector('#registerForm');if(!f||f.dataset.apiBound)return;
 f.dataset.apiBound='1';
 let current=1;
 const steps=[...f.querySelectorAll('[data-reg-step]')],bars=[...document.querySelectorAll('.progress .step')];
 const show=n=>{current=Math.max(1,Math.min(n,steps.length));steps.forEach((x,i)=>x.classList.toggle('hidden',i!==current-1));bars.forEach((x,i)=>x.classList.toggle('active',i<current));};
 const message=(()=>{let x=document.querySelector('#registerMsg');if(!x){x=document.createElement('div');x.id='registerMsg';x.className='notice hidden';f.prepend(x);}return x;})();
 const tell=(t,ok=false)=>{message.textContent=t;message.classList.remove('hidden','info','success','error');message.classList.add(ok?'success':'error');};
 f.querySelectorAll('[data-next]').forEach(b=>b.addEventListener('click',()=>{
  const section=steps[current-1];
  const invalid=[...section.querySelectorAll('input,select')].find(x=>x.required&&!x.disabled&&x.offsetParent!==null&&!x.checkValidity());
  if(invalid){invalid.reportValidity();return;}
  show(current+1);
 }));
 f.querySelectorAll('[data-prev]').forEach(b=>b.addEventListener('click',()=>show(current-1)));
 f.querySelectorAll('input[name="role"]').forEach(x=>x.addEventListener('change',()=>{
  document.querySelectorAll('.role-card').forEach(c=>c.classList.toggle('active',!!c.querySelector('input:checked')));
 }));
 f.addEventListener('submit',async e=>{
  e.preventDefault();
  const v=Object.fromEntries(new FormData(f).entries());
  const phoneRaw=(v.phone||'').replace(/[\s()-]/g,'');
  if(/^07\d{8}$/.test(phoneRaw))v.phone='+962'+phoneRaw.slice(1);
  else if(/^9627\d{8}$/.test(phoneRaw))v.phone='+'+phoneRaw;
  else if(/^\+9627\d{8}$/.test(phoneRaw))v.phone=phoneRaw;
  else{show(2);tell('أدخل رقم هاتف أردني صحيحًا مثل 0791234567.');f.elements.phone.focus();return;}
  v.role=v.role||'passenger';
  if(v.role==='driver'){
   if(!v.vehicleType||!v.carModel||!v.carYear||!v.passengerSeats){show(4);tell('أكمل بيانات المركبة المطلوبة قبل إنشاء الحساب.');return;}
   v.carYear=Number(v.carYear);v.passengerSeats=Number(v.passengerSeats);
  }
  const submit=f.querySelector('button[type="submit"],button:not([type])');
  if(submit){submit.disabled=true;submit.textContent='جارٍ إنشاء الحساب...';}
  try{
   const response=await fetch('http://localhost:5000/api/auth/register',{
    method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},
    body:JSON.stringify(v)
   });
   const data=await response.json();
   if(!response.ok)throw new Error(response.status===409?'البريد أو الهاتف أو اسم المستخدم مستخدم مسبقًا.':response.status===400?'تحقق من البيانات المطلوبة واسم المستخدم ورقم الهاتف.':'تعذر إنشاء الحساب. حاول مجددًا.');
   localStorage.setItem('darb_current_user',JSON.stringify(data.user));
   localStorage.setItem('darb_session',data.token);
   localStorage.setItem('darb_users_session',data.token);
   tell('تم إنشاء الحساب بنجاح. جارٍ تحويلك...',true);
   setTimeout(()=>location.href=data.user.role==='driver'?'driver.html':'dashboard.html',700);
  }catch(err){tell(err.message||'تعذر الاتصال بالخادم. تأكد أن API يعمل على المنفذ 5000.');}
  finally{if(submit){submit.disabled=false;submit.textContent='إنشاء الحساب';}}
 });
 show(1);
}document.addEventListener('DOMContentLoaded',()=>{fillUniversities();setupLocations();role();login();register();document.querySelectorAll('[data-password-toggle]').forEach(b=>b.onclick=()=>{const i=document.querySelector(b.dataset.passwordToggle);if(i)i.type=i.type==='password'?'text':'password'});const reset=document.querySelector('[data-reset-demo]');if(reset)reset.onclick=()=>{if(confirm('سيتم حذف بيانات التجربة المحلية بالكامل. هل أنت متأكد؟')){Object.values(D.KEYS).forEach(k=>D.STORAGE.remove(k));location.href='index.html'}}});
})();
