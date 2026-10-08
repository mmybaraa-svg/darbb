# إعداد SQL Server

يتطلب دَرْب SQL Server و.NET 8 SDK. يستضيف ASP.NET Core صفحات الموقع وواجهة API من نفس المصدر؛ لا تتصل صفحات المتصفح بقاعدة البيانات مباشرة.

1. أنشئ قاعدة بيانات باسم `Darb` في SQL Server.
2. نفّذ `server/Darb.Api/database.sql` عليها.
3. عيّن متغير البيئة `DARB_SQL_CONNECTION` إلى سلسلة اتصال SQL Server، مع تفعيل التشفير وعدم تعطيله في الإنتاج. مثال تطوير محلي:

   ```powershell
   $env:DARB_SQL_CONNECTION = "Server=localhost;Database=Darb;Integrated Security=True;TrustServerCertificate=True"
   ```

4. عيّن `DARB_TOKEN_SECRET` إلى سر عشوائي طويل قبل التشغيل:

   ```powershell
   $secret = New-Object byte[] 48
   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($secret)
   $rng.Dispose()
   $env:DARB_TOKEN_SECRET = [Convert]::ToBase64String($secret)
   ```

   لا تستخدم القيمة الافتراضية محليًا على خادم منشور، ولا تحفظ الأسرار في ملفات المشروع.
5. شغّل API من مجلد `server/Darb.Api`:

   ```powershell
   dotnet run
   ```

6. افتح عنوان ASP.NET Core الظاهر في الطرفية. ينفّذ التطبيق الطلبات إلى SQL Server باستخدام حساب الخادم؛ لا تضع كلمة مرور قاعدة البيانات في ملفات JavaScript.

في الإنتاج، استخدم HTTPS بين المتصفح والخادم، واحفظ متغيرات البيئة في مخزن أسرار الخادم، وامنح حساب SQL Server أقل الصلاحيات اللازمة.

حسابات المستخدمين والملفات الشخصية والرحلات والحجوزات والإشعارات والمتابعات والتقييمات والمحادثات والرسائل وسجلات التتبع تحفظ في SQL Server. كلمة المرور تحفظ كبصمة PBKDF2 مع salt؛ ورمز الدخول الموقّع يحتفظ به المتصفح محليًا لمدة سبعة أيام. صور الملفات الشخصية تحفظ كبيانات صورة داخل الملف الشخصي في قاعدة البيانات، مع حد 1 ميغابايت كما في الواجهة.

لا يجري ترحيل البيانات السابقة تلقائيًا؛ لا تتوفر لهذا المشروع بيانات اعتماد أو ملفات تصدير لاستيرادها.
