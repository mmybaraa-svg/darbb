using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 2_000_000);
var webRoot = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", ".."));
var app = builder.Build();
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? Environment.GetEnvironmentVariable("DARB_SQL_CONNECTION");
var tokenSecret = Environment.GetEnvironmentVariable("DARB_TOKEN_SECRET");
var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    if (path.StartsWith("/server", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/.", StringComparison.Ordinal)
        || path.EndsWith(".sql", StringComparison.OrdinalIgnoreCase)
        || path.EndsWith(".md", StringComparison.OrdinalIgnoreCase)
        || path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)
        || path.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});
app.UseDefaultFiles(new DefaultFilesOptions
{
    FileProvider = new PhysicalFileProvider(webRoot)
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(webRoot)
});

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (ApiException error)
    {
        context.Response.StatusCode = error.StatusCode;
        await context.Response.WriteAsJsonAsync(new { error = error.Message });
    }
    catch (SqlException error)
    {
        app.Logger.LogError(error, "SQL Server operation failed");
        var connectionFailure = error.Number is 2 or 20 or 40 or 53 or 258 or 4060 or 10060 or 10061 or 11001 or 18456;
        context.Response.StatusCode = connectionFailure
            ? StatusCodes.Status503ServiceUnavailable
            : StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new
        {
            error = connectionFailure
                ? "ØªØ¹Ø°Ø± Ø§Ù„Ø§ØªØµØ§Ù„ Ø¨Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª. ØªØ­Ù‚Ù‚ Ù…Ù† Ø¥Ø¹Ø¯Ø§Ø¯ SQL Server."
                : "ØªØ¹Ø°Ø±Øª Ù…Ø¹Ø§Ù„Ø¬Ø© Ø§Ù„Ø·Ù„Ø¨ ÙÙŠ SQL Server."
        });
    }
});

app.MapGet("/api/health", async () =>
{
    await using var connection = await OpenDatabase();
    return Results.Ok(new { status = "ok", database = "SQL Server" });
});

app.MapPost("/api/auth/register", async (HttpContext context) =>
{
    EnsureTokenSecret();
    var body = await ReadBody(context);
    var email = Text(body, "email").Trim().ToLowerInvariant();
    var phone = Text(body, "phone").Trim();
    var username = Text(body, "username").Trim().ToLowerInvariant();
    var password = Text(body, "password");
    var role = Text(body, "role");
    if (email.Length > 320 || !System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")
        || !System.Text.RegularExpressions.Regex.IsMatch(phone, @"^\+9627\d{8}$")
        || Text(body, "fullName").Trim().Length is < 1 or > 120
        || Text(body, "gender") is not ("ذكر" or "أنثى")
        || !System.Text.RegularExpressions.Regex.IsMatch(username, "^[a-z0-9_]{3,20}$")
        || password.Length is < 6 or > 256 || role is not ("driver" or "passenger")
        || string.IsNullOrWhiteSpace(Text(body, "university"))
        || string.IsNullOrWhiteSpace(Text(body, "governorate"))
        || (role == "driver" && (string.IsNullOrWhiteSpace(Text(body, "vehicleType"))
            || string.IsNullOrWhiteSpace(Text(body, "carModel"))
            || Integer(body, "carYear") is < 1990 or > 2035
            || Integer(body, "passengerSeats") is < 1 or > 20)))
        throw new ApiException(400, "ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ø¨Ø±ÙŠØ¯ ÙˆØ§Ù„Ù‡Ø§ØªÙ ÙˆØ§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ÙˆÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± ÙˆØ§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨Ø©.");

    var id = Guid.NewGuid().ToString("N");
    var profile = new JsonObject
    {
        ["id"] = id,
        ["email"] = email,
        ["phone"] = phone,
        ["username"] = username,
        ["role"] = role
    };
    foreach (var field in new[]
    {
        "fullName", "gender", "university", "governorate", "area", "locality",
        "vehicleType", "carModel", "carYear", "passengerSeats", "plateNumber"
    })
    {
        if (body[field] is not null) profile[field] = body[field]!.DeepClone();
    }
    var salt = RandomNumberGenerator.GetBytes(16);
    var hash = HashPassword(password, salt);
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        INSERT INTO dbo.Profiles (UserId, Email, Phone, Username, PasswordSalt, PasswordHash, ProfileJson)
        VALUES (@id, @email, @phone, @username, @salt, @hash, @profile)
        """, connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 64);
    Add(command, "@email", email, SqlDbType.NVarChar, 320);
    Add(command, "@phone", phone, SqlDbType.NVarChar, 32);
    Add(command, "@username", username, SqlDbType.NVarChar, 20);
    Add(command, "@salt", salt, SqlDbType.VarBinary, 16);
    Add(command, "@hash", hash, SqlDbType.VarBinary, 32);
    Add(command, "@profile", profile.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
    try
    {
        await command.ExecuteNonQueryAsync();
    }
    catch (SqlException error) when (error.Number is 2601 or 2627)
    {
        throw new ApiException(409, "Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø£Ùˆ Ø§Ù„Ù‡Ø§ØªÙ Ø£Ùˆ Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ù…Ø³Ø¬Ù„ Ù…Ø³Ø¨Ù‚Ù‹Ø§.");
    }
    return Results.Ok(new { user = profile, token = CreateToken(id) });
});

app.MapPost("/api/auth/login", async (HttpContext context) =>
{
    EnsureTokenSecret();
    var body = await ReadBody(context);
    var identifier = Text(body, "identifier").Trim();
    var password = Text(body, "password");
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        SELECT UserId, PasswordSalt, PasswordHash, ProfileJson
        FROM dbo.Profiles WHERE Email = @identifier OR Phone = @identifier
        """, connection);
    Add(command, "@identifier", identifier.ToLowerInvariant(), SqlDbType.NVarChar, 320);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync() || !CryptographicOperations.FixedTimeEquals(
        HashPassword(password, (byte[])reader["PasswordSalt"]), (byte[])reader["PasswordHash"]))
        throw new ApiException(401, "Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ Ø£Ùˆ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± ØºÙŠØ± ØµØ­ÙŠØ­Ø©.");
    var userId = reader.GetString(0);
    var user = JsonNode.Parse(reader.GetString(3));
    return Results.Ok(new { user, token = CreateToken(userId) });
});

app.MapGet("/api/auth/me", async (HttpContext context) =>
{
    var userId = RequireUser(context);
    var profile = await LoadProfile(userId);
    return Results.Ok(profile);
});

app.MapPost("/api/auth/logout", (HttpContext context) =>
{
    RequireUser(context);
    return Results.NoContent();
});

app.MapGet("/api/trips", async () =>
{
    var result = new List<JsonNode>();
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("SELECT TripJson FROM dbo.Trips ORDER BY TripId DESC", connection);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
        result.Add(JsonNode.Parse(reader.GetString(0))!);
    return Results.Json(result, jsonOptions);
});

app.MapPost("/api/trips", async (HttpContext context) =>
{
    var userId = RequireUser(context);
    var profile = await LoadProfile(userId);
    if (Text(profile, "role") != "driver") throw new ApiException(403, "Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø±Ø­Ù„Ø§Øª Ù…ØªØ§Ø­ Ù„Ù„Ø³Ø§Ø¦Ù‚ÙŠÙ† ÙÙ‚Ø·.");
    var trip = await ReadBody(context);
    var id = Text(trip, "id");
    if (string.IsNullOrWhiteSpace(id)) id = Guid.NewGuid().ToString("N");
    if (id.Length > 48) throw new ApiException(400, "Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ø±Ø­Ù„Ø© ØºÙŠØ± ØµØ§Ù„Ø­.");
    trip["id"] = id;
    trip["driverId"] = userId;
    trip["driverName"] = Text(profile, "fullName");
    trip["driverGender"] = Text(profile, "gender");
    trip["status"] = "open";
    trip.Remove("driverLocation");
    var seats = Integer(trip, "availableSeats");
    if (seats < 1 || seats > 20 || Integer(trip, "totalSeats") != seats || Number(trip, "price") < 0)
        throw new ApiException(400, "Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ù‚Ø§Ø¹Ø¯ Ø£Ùˆ Ø§Ù„Ø³Ø¹Ø± ØºÙŠØ± ØµØ§Ù„Ø­Ø©.");
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        INSERT INTO dbo.Trips (TripId, DriverId, Status, AvailableSeats, TripJson)
        VALUES (@id, @driver, @status, @seats, @json)
        """, connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 64);
    Add(command, "@driver", userId, SqlDbType.NVarChar, 64);
    Add(command, "@status", "open", SqlDbType.NVarChar, 24);
    Add(command, "@seats", seats, SqlDbType.Int);
    Add(command, "@json", trip.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
    await command.ExecuteNonQueryAsync();
    return Results.Created($"/api/trips/{id}", trip);
});

app.MapPut("/api/trips/{id}", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    var trip = await ReadBody(context);
    await using var connection = await OpenDatabase();
    await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable);
    await using var command = new SqlCommand("""
        UPDATE dbo.Trips SET Status = @status, AvailableSeats = @seats, TripJson = @json
        WHERE TripId = @id AND DriverId = @driver
        """, connection, transaction);
    var status = Text(trip, "status");
    if (status is not ("open" or "full" or "cancelled" or "completed"))
        throw new ApiException(400, "Ø­Ø§Ù„Ø© Ø§Ù„Ø±Ø­Ù„Ø© ØºÙŠØ± ØµØ§Ù„Ø­Ø©.");
    var totalSeats = Integer(trip, "totalSeats");
    if (totalSeats is < 1 or > 20) throw new ApiException(400, "Ø¹Ø¯Ø¯ Ø§Ù„Ù…Ù‚Ø§Ø¹Ø¯ ØºÙŠØ± ØµØ§Ù„Ø­.");
    var profile = await LoadProfile(userId);
    trip["driverName"] = Text(profile, "fullName");
    trip["driverGender"] = Text(profile, "gender");
    await using var current = new SqlCommand("SELECT Status, AvailableSeats, TripJson FROM dbo.Trips WITH (UPDLOCK, ROWLOCK) WHERE TripId=@id AND DriverId=@driver", connection, transaction);
    Add(current, "@id", id, SqlDbType.NVarChar, 64);
    Add(current, "@driver", userId, SqlDbType.NVarChar, 64);
    await using var currentReader = await current.ExecuteReaderAsync();
    if (!await currentReader.ReadAsync()) throw new ApiException(404, "Ø§Ù„Ø±Ø­Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø© Ø£Ùˆ Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© ØªØ¹Ø¯ÙŠÙ„Ù‡Ø§.");
    var currentStatus = currentReader.GetString(0);
    var currentAvailable = currentReader.GetInt32(1);
    var currentTrip = JsonNode.Parse(currentReader.GetString(2))!;
    await currentReader.CloseAsync();
    var occupiedSeats = Integer(currentTrip, "totalSeats") - currentAvailable;
    if (totalSeats < occupiedSeats) throw new ApiException(409, "Ù„Ø§ ÙŠÙ…ÙƒÙ† ØªÙ‚Ù„ÙŠÙ„ Ø§Ù„Ø³Ø¹Ø© Ø¹Ù† Ø¹Ø¯Ø¯ Ø§Ù„Ù…Ù‚Ø§Ø¹Ø¯ Ø§Ù„Ù…Ø­Ø¬ÙˆØ²Ø©.");
    var seats = totalSeats - occupiedSeats;
    if (status != "cancelled" && currentStatus == "cancelled")
        throw new ApiException(409, "Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¥Ø¹Ø§Ø¯Ø© ÙØªØ­ Ø±Ø­Ù„Ø© Ù…Ù„ØºØ§Ø©.");
    status = status == "cancelled" ? "cancelled" : seats == 0 ? "full" : "open";
    trip["totalSeats"] = totalSeats;
    trip["availableSeats"] = seats;
    trip["status"] = status;
    Add(command, "@id", id, SqlDbType.NVarChar, 64);
    Add(command, "@driver", userId, SqlDbType.NVarChar, 64);
    Add(command, "@status", status, SqlDbType.NVarChar, 24);
    Add(command, "@seats", seats, SqlDbType.Int);
    trip["id"] = id;
    trip["driverId"] = userId;
    trip.Remove("driverLocation");
    Add(command, "@json", trip.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
    if (await command.ExecuteNonQueryAsync() == 0) throw new ApiException(404, "Ø§Ù„Ø±Ø­Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø© Ø£Ùˆ Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© ØªØ¹Ø¯ÙŠÙ„Ù‡Ø§.");
    await transaction.CommitAsync();
    return Results.Ok(trip);
});

app.MapDelete("/api/trips/{id}", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        UPDATE dbo.Trips
        SET Status='cancelled', TripJson=JSON_MODIFY(TripJson,'$.status','cancelled')
        WHERE TripId=@id AND DriverId=@driver
        """, connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 64);
    Add(command, "@driver", userId, SqlDbType.NVarChar, 64);
    if (await command.ExecuteNonQueryAsync() == 0) throw new ApiException(404, "Ø§Ù„Ø±Ø­Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø© Ø£Ùˆ Ù„Ø§ ØªÙ…Ù„Ùƒ ØµÙ„Ø§Ø­ÙŠØ© Ø­Ø°ÙÙ‡Ø§.");
    return Results.NoContent();
});

app.MapGet("/api/bookings", async (HttpContext context) =>
{
    var userId = RequireUser(context);
    var bookings = new List<JsonNode>();
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        SELECT BookingJson FROM dbo.Bookings
        WHERE PassengerId = @user OR DriverId = @user ORDER BY CreatedAt DESC
        """, connection);
    Add(command, "@user", userId, SqlDbType.NVarChar, 64);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) bookings.Add(JsonNode.Parse(reader.GetString(0))!);
    return Results.Json(bookings, jsonOptions);
});

app.MapPost("/api/bookings", async (HttpContext context) =>
{
    var userId = RequireUser(context);
    if (Text(await LoadProfile(userId), "role") != "passenger")
        throw new ApiException(403, "Ø¥Ø±Ø³Ø§Ù„ Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ø­Ø¬Ø² Ù…ØªØ§Ø­ Ù„Ù„Ø±ÙƒØ§Ø¨ ÙÙ‚Ø·.");
    var booking = await ReadBody(context);
    var tripId = Text(booking, "tripId");
    var bookingId = Text(booking, "id");
    if (string.IsNullOrWhiteSpace(bookingId)) bookingId = Guid.NewGuid().ToString("N");
    if (bookingId.Length > 48) throw new ApiException(400, "Ù…Ø¹Ø±Ù‘Ù Ø§Ù„Ø­Ø¬Ø² ØºÙŠØ± ØµØ§Ù„Ø­.");
    await using var connection = await OpenDatabase();
    await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable);
    var tripCommand = new SqlCommand("""
        SELECT DriverId, Status, AvailableSeats, TripJson
        FROM dbo.Trips WITH (UPDLOCK, ROWLOCK) WHERE TripId = @trip
        """, connection, transaction);
    Add(tripCommand, "@trip", tripId, SqlDbType.NVarChar, 64);
    await using var tripReader = await tripCommand.ExecuteReaderAsync();
    if (!await tripReader.ReadAsync()) throw new ApiException(404, "Ø§Ù„Ø±Ø­Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©.");
    var driverId = tripReader.GetString(0);
    var status = tripReader.GetString(1);
    var tripJson = JsonNode.Parse(tripReader.GetString(3))!;
    await tripReader.CloseAsync();
    if (driverId == userId || status != "open") throw new ApiException(409, "Ø§Ù„Ø±Ø­Ù„Ø© ØºÙŠØ± Ù…ØªØ§Ø­Ø© Ù„Ù„Ø­Ø¬Ø².");
    var duplicate = new SqlCommand("""
        SELECT COUNT(1) FROM dbo.Bookings
        WHERE TripId = @trip AND PassengerId = @user AND Status IN ('pending','confirmed')
        """, connection, transaction);
    Add(duplicate, "@trip", tripId, SqlDbType.NVarChar, 64);
    Add(duplicate, "@user", userId, SqlDbType.NVarChar, 64);
    if ((int)await duplicate.ExecuteScalarAsync()! > 0)
        throw new ApiException(409, "Ù„Ø¯ÙŠÙƒ Ø·Ù„Ø¨ Ø­Ø¬Ø² Ù‚Ø§Ø¦Ù… Ù„Ù‡Ø°Ù‡ Ø§Ù„Ø±Ø­Ù„Ø©.");
    booking["id"] = bookingId;
    booking["tripId"] = tripId;
    booking["passengerId"] = userId;
    booking["driverId"] = driverId;
    booking["status"] = "pending";
    if (Integer(booking, "requestedSeats") < 1 || Integer(booking, "requestedSeats") > Integer(tripJson, "availableSeats"))
        throw new ApiException(409, "Ø¹Ø¯Ø¯ Ø§Ù„Ù…Ù‚Ø§Ø¹Ø¯ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨ ØºÙŠØ± Ù…ØªØ§Ø­.");
    var insert = new SqlCommand("""
        INSERT INTO dbo.Bookings (BookingId, TripId, PassengerId, DriverId, Status, BookingJson)
        VALUES (@id, @trip, @passenger, @driver, @status, @json)
        """, connection, transaction);
    Add(insert, "@id", bookingId, SqlDbType.NVarChar, 64);
    Add(insert, "@trip", tripId, SqlDbType.NVarChar, 64);
    Add(insert, "@passenger", userId, SqlDbType.NVarChar, 64);
    Add(insert, "@driver", driverId, SqlDbType.NVarChar, 64);
    Add(insert, "@status", "pending", SqlDbType.NVarChar, 24);
    Add(insert, "@json", booking.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
    await insert.ExecuteNonQueryAsync();
    var notification = new SqlCommand("""
        INSERT INTO dbo.Notifications(NotificationId,UserId,Message)
        VALUES(@id,@user,@message)
        """, connection, transaction);
    Add(notification, "@id", Guid.NewGuid().ToString("N"), SqlDbType.NVarChar, 64);
    Add(notification, "@user", driverId, SqlDbType.NVarChar, 64);
    Add(notification, "@message", "Ù„Ø¯ÙŠÙƒ Ø·Ù„Ø¨ Ø­Ø¬Ø² Ø¬Ø¯ÙŠØ¯.", SqlDbType.NVarChar, 500);
    await notification.ExecuteNonQueryAsync();
    await transaction.CommitAsync();
    return Results.Created($"/api/bookings/{bookingId}", booking);
});

app.MapGet("/api/notifications", async (HttpContext context) =>
{
    var userId = RequireUser(context);
    var notifications = new List<object>();
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        SELECT NotificationId, Message, CreatedAt, IsRead
        FROM dbo.Notifications WHERE UserId=@user ORDER BY CreatedAt DESC
        """, connection);
    Add(command, "@user", userId, SqlDbType.NVarChar, 64);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        notifications.Add(new
        {
            id = reader.GetString(0),
            userId,
            message = reader.GetString(1),
            createdAt = reader.GetDateTime(2).ToUniversalTime().ToString("O"),
            read = reader.GetBoolean(3)
        });
    }
    return Results.Json(notifications, jsonOptions);
});

app.MapPatch("/api/bookings/{id}", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    var body = await ReadBody(context);
    var nextStatus = Text(body, "status");
    if (nextStatus is not ("confirmed" or "rejected" or "cancelled")) throw new ApiException(400, "Ø­Ø§Ù„Ø© Ø§Ù„Ø­Ø¬Ø² ØºÙŠØ± ØµØ§Ù„Ø­Ø©.");
    await using var connection = await OpenDatabase();
    await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.Serializable);
    var select = new SqlCommand("""
        SELECT TripId, PassengerId, DriverId, Status, BookingJson
        FROM dbo.Bookings WITH (UPDLOCK, ROWLOCK) WHERE BookingId = @id
        """, connection, transaction);
    Add(select, "@id", id, SqlDbType.NVarChar, 64);
    await using var reader = await select.ExecuteReaderAsync();
    if (!await reader.ReadAsync()) throw new ApiException(404, "Ø·Ù„Ø¨ Ø§Ù„Ø­Ø¬Ø² ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.");
    var tripId = reader.GetString(0);
    var passengerId = reader.GetString(1);
    var driverId = reader.GetString(2);
    var currentStatus = reader.GetString(3);
    var booking = JsonNode.Parse(reader.GetString(4))!;
    await reader.CloseAsync();
    if (nextStatus == "cancelled")
    {
        if (passengerId != userId || currentStatus is not ("pending" or "confirmed"))
            throw new ApiException(403, "Ù„Ø§ ÙŠÙ…ÙƒÙ†Ùƒ Ø¥Ù„ØºØ§Ø¡ Ù‡Ø°Ø§ Ø§Ù„Ø­Ø¬Ø².");
    }
    else if (driverId != userId || currentStatus != "pending")
        throw new ApiException(403, "Ù„Ù… ÙŠØ¹Ø¯ Ø·Ù„Ø¨ Ø§Ù„Ø­Ø¬Ø² Ù…ØªØ§Ø­Ù‹Ø§ Ù„Ù„ØªØ­Ø¯ÙŠØ«.");
    if (nextStatus == "confirmed" || (nextStatus == "cancelled" && currentStatus == "confirmed"))
    {
        var trip = new SqlCommand("SELECT AvailableSeats, TripJson FROM dbo.Trips WITH (UPDLOCK, ROWLOCK) WHERE TripId = @id", connection, transaction);
        Add(trip, "@id", tripId, SqlDbType.NVarChar, 64);
        await using var tripReader = await trip.ExecuteReaderAsync();
        if (!await tripReader.ReadAsync()) throw new ApiException(404, "Ø§Ù„Ø±Ø­Ù„Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©.");
        var available = tripReader.GetInt32(0);
        var tripJson = JsonNode.Parse(tripReader.GetString(1))!;
        await tripReader.CloseAsync();
        var tripStatus = Text(tripJson, "status");
        if (nextStatus == "confirmed" && tripStatus != "open")
            throw new ApiException(409, "Ø§Ù„Ø±Ø­Ù„Ø© Ù„Ù… ØªØ¹Ø¯ Ù…ØªØ§Ø­Ø© Ù„Ù‚Ø¨ÙˆÙ„ Ø§Ù„Ø­Ø¬Ø².");
        var requested = Integer(booking, "requestedSeats");
        if (nextStatus == "confirmed" && available < requested)
            throw new ApiException(409, "Ù„Ø§ ØªÙˆØ¬Ø¯ Ù…Ù‚Ø§Ø¹Ø¯ ÙƒØ§ÙÙŠØ© Ù„Ù‚Ø¨ÙˆÙ„ Ø§Ù„Ø·Ù„Ø¨.");
        var nextSeats = nextStatus == "confirmed" ? available - requested : available + requested;
        tripJson["availableSeats"] = nextSeats;
        var nextTripStatus = tripStatus == "cancelled" ? "cancelled" : nextSeats == 0 ? "full" : "open";
        tripJson["status"] = nextTripStatus;
        var updateTrip = new SqlCommand("UPDATE dbo.Trips SET AvailableSeats=@seats, Status=@status, TripJson=@json WHERE TripId=@id", connection, transaction);
        Add(updateTrip, "@seats", nextSeats, SqlDbType.Int);
        Add(updateTrip, "@status", nextTripStatus, SqlDbType.NVarChar, 24);
        Add(updateTrip, "@json", tripJson.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
        Add(updateTrip, "@id", tripId, SqlDbType.NVarChar, 64);
        await updateTrip.ExecuteNonQueryAsync();
    }
    booking["status"] = nextStatus;
    var update = new SqlCommand("UPDATE dbo.Bookings SET Status=@status, BookingJson=@json WHERE BookingId=@id", connection, transaction);
    Add(update, "@status", nextStatus, SqlDbType.NVarChar, 24);
    Add(update, "@json", booking.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
    Add(update, "@id", id, SqlDbType.NVarChar, 64);
    await update.ExecuteNonQueryAsync();
    var notification = new SqlCommand("""
        INSERT INTO dbo.Notifications(NotificationId,UserId,Message)
        VALUES(@id,@user,@message)
        """, connection, transaction);
    Add(notification, "@id", Guid.NewGuid().ToString("N"), SqlDbType.NVarChar, 64);
    Add(notification, "@user", nextStatus == "cancelled" ? driverId : passengerId, SqlDbType.NVarChar, 64);
    Add(notification, "@message", nextStatus switch
    {
        "confirmed" => "ØªÙ… Ù‚Ø¨ÙˆÙ„ Ø·Ù„Ø¨ Ø§Ù„Ø­Ø¬Ø².",
        "rejected" => "ØªÙ… Ø±ÙØ¶ Ø·Ù„Ø¨ Ø§Ù„Ø­Ø¬Ø².",
        _ => "ØªÙ… Ø¥Ù„ØºØ§Ø¡ Ø§Ù„Ø­Ø¬Ø²."
    }, SqlDbType.NVarChar, 500);
    await notification.ExecuteNonQueryAsync();
    await transaction.CommitAsync();
    return Results.Ok(booking);
});

app.MapGet("/api/users", async () =>
{
    var profiles = new List<JsonNode>();
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("SELECT UserId, ProfileJson FROM dbo.Profiles ORDER BY CreatedAt DESC", connection);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) profiles.Add(PublicProfile(JsonNode.Parse(reader.GetString(1))!, reader.GetString(0), includePhoto: false));
    return Results.Json(profiles, jsonOptions);
});

app.MapGet("/api/users/{id}", async (string id) =>
{
    var profile = await LoadProfile(id);
    await using var connection = await OpenDatabase();
    await using var counts = new SqlCommand("""
        SELECT
          (SELECT COUNT(1) FROM dbo.Follows WHERE FollowingId=@id),
          (SELECT COUNT(1) FROM dbo.Follows WHERE FollowerId=@id)
        """, connection);
    Add(counts, "@id", id, SqlDbType.NVarChar, 64);
    await using var reader = await counts.ExecuteReaderAsync();
    if (await reader.ReadAsync())
    {
        profile["followersCount"] = reader.GetInt32(0);
        profile["followingCount"] = reader.GetInt32(1);
    }
    return Results.Json(PublicProfile(profile, id), jsonOptions);
});

app.MapPut("/api/users/me", async (HttpContext context) =>
{
    var userId = RequireUser(context);
    var incoming = await ReadBody(context);
    var profile = (await LoadProfile(userId)).AsObject();
    profile["id"] = userId;
    foreach (var field in new[]
    {
        "fullName", "username", "bio", "university", "governorate",
        "area", "locality", "profilePhoto", "vehicleType", "carModel",
        "carYear", "passengerSeats", "plateNumber"
    })
    {
        if (incoming[field] is not null) profile[field] = incoming[field]!.DeepClone();
    }
    var username = Text(profile, "username").Trim().ToLowerInvariant();
    if (!System.Text.RegularExpressions.Regex.IsMatch(username, "^[a-z0-9_]{3,20}$"))
        throw new ApiException(400, "Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… ÙŠØ¬Ø¨ Ø£Ù† ÙŠÙƒÙˆÙ† Ù…Ù† 3 Ø¥Ù„Ù‰ 20 Ø­Ø±ÙÙ‹Ø§ Ø£Ùˆ Ø±Ù‚Ù…Ù‹Ø§ Ø£Ùˆ _.");
    profile["username"] = username;
    var photo = Text(profile, "profilePhoto");
    if (photo.Length > 1_500_000) throw new ApiException(413, "Ø­Ø¬Ù… ØµÙˆØ±Ø© Ø§Ù„Ù…Ù„Ù Ø§Ù„Ø´Ø®ØµÙŠ Ø£ÙƒØ¨Ø± Ù…Ù† Ø§Ù„Ù…Ø³Ù…ÙˆØ­.");
    if (photo.Length > 0
        && !photo.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
        && !System.Text.RegularExpressions.Regex.IsMatch(photo, "^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$"))
        throw new ApiException(400, "ØµÙŠØºØ© ØµÙˆØ±Ø© Ø§Ù„Ù…Ù„Ù Ø§Ù„Ø´Ø®ØµÙŠ ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…Ø©.");
    var connection = await OpenDatabase();
    await using (connection)
    await using (var command = new SqlCommand("UPDATE dbo.Profiles SET Username=@username, ProfileJson=@json WHERE UserId=@id", connection))
    {
        Add(command, "@username", username, SqlDbType.NVarChar, 20);
        Add(command, "@json", profile.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
        Add(command, "@id", userId, SqlDbType.NVarChar, 64);
        try
        {
            if (await command.ExecuteNonQueryAsync() == 0) throw new ApiException(404, "Ø§Ù„Ø­Ø³Ø§Ø¨ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.");
        }
        catch (SqlException error) when (error.Number is 2601 or 2627)
        {
            throw new ApiException(409, "Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ù…Ø³ØªØ®Ø¯Ù…. Ø§Ø®ØªØ± Ø§Ø³Ù…Ù‹Ø§ Ø¢Ø®Ø±.");
        }
    }
    return Results.Ok(profile);
});

app.MapGet("/api/users/{id}/following/{viewerId}", async (string id, string viewerId, HttpContext context) =>
{
    var userId = RequireUser(context);
    if (viewerId != userId) throw new ApiException(403, "ØºÙŠØ± Ù…ØµØ±Ø­.");
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("SELECT COUNT(1) FROM dbo.Follows WHERE FollowerId=@follower AND FollowingId=@following", connection);
    Add(command, "@follower", userId, SqlDbType.NVarChar, 64);
    Add(command, "@following", id, SqlDbType.NVarChar, 64);
    return Results.Ok(new { following = (int)await command.ExecuteScalarAsync()! > 0 });
});

app.MapPut("/api/users/{id}/following", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    if (id == userId) throw new ApiException(400, "Ù„Ø§ ÙŠÙ…ÙƒÙ†Ùƒ Ù…ØªØ§Ø¨Ø¹Ø© Ø­Ø³Ø§Ø¨Ùƒ.");
    var body = await ReadBody(context);
    await using var connection = await OpenDatabase();
    var followed = Boolean(body, "following");
    await using var command = new SqlCommand(followed
        ? "IF NOT EXISTS (SELECT 1 FROM dbo.Follows WHERE FollowerId=@f AND FollowingId=@t) INSERT INTO dbo.Follows(FollowerId,FollowingId) VALUES(@f,@t)"
        : "DELETE FROM dbo.Follows WHERE FollowerId=@f AND FollowingId=@t", connection);
    Add(command, "@f", userId, SqlDbType.NVarChar, 64);
    Add(command, "@t", id, SqlDbType.NVarChar, 64);
    await command.ExecuteNonQueryAsync();
    return Results.NoContent();
});

app.MapGet("/api/users/{id}/ratings", async (string id) =>
{
    var ratings = new List<JsonNode>();
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("SELECT RatingJson FROM dbo.Ratings WHERE DriverId=@id ORDER BY CreatedAt DESC", connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 64);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) ratings.Add(JsonNode.Parse(reader.GetString(0))!);
    return Results.Json(ratings, jsonOptions);
});

app.MapGet("/api/users/{id}/rating-eligibility", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    var eligible = new List<JsonNode>();
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        SELECT b.BookingId,b.TripId FROM dbo.Bookings b
        JOIN dbo.UserRecords r ON r.RecordType='tracking' AND r.RecordId=b.BookingId
        WHERE b.PassengerId=@passenger AND b.DriverId=@driver AND b.Status='confirmed'
          AND JSON_VALUE(r.RecordJson,'$.status')='completed'
          AND NOT EXISTS(SELECT 1 FROM dbo.Ratings x WHERE x.TripId=b.TripId AND x.PassengerId=@passenger)
        """, connection);
    Add(command, "@passenger", userId, SqlDbType.NVarChar, 64);
    Add(command, "@driver", id, SqlDbType.NVarChar, 64);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) eligible.Add(new JsonObject { ["bookingId"] = reader.GetString(0), ["tripId"] = reader.GetString(1) });
    return Results.Json(eligible, jsonOptions);
});

app.MapPost("/api/ratings", async (HttpContext context) =>
{
    var userId = RequireUser(context);
    var rating = await ReadBody(context);
    var tripId = Text(rating, "tripId");
    var bookingId = Text(rating, "bookingId");
    var stars = Integer(rating, "stars");
    if (stars is < 1 or > 5) throw new ApiException(400, "Ø§Ù„ØªÙ‚ÙŠÙŠÙ… ÙŠØ¬Ø¨ Ø£Ù† ÙŠÙƒÙˆÙ† Ø¨ÙŠÙ† Ù†Ø¬Ù…Ø© ÙˆØ®Ù…Ø³ Ù†Ø¬ÙˆÙ….");
    if (Text(rating, "comment").Length > 1000) throw new ApiException(400, "Ø§Ù„ØªØ¹Ù„ÙŠÙ‚ Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠØªØ¬Ø§ÙˆØ² 1000 Ø­Ø±Ù.");
    rating["id"] = $"{tripId}__{userId}";
    rating["passengerId"] = userId;
    rating["createdAt"] = DateTimeOffset.UtcNow.ToString("O");
    var connection = await OpenDatabase();
    await using (connection)
    await using (var command = new SqlCommand("""
        INSERT INTO dbo.Ratings (RatingId, TripId, BookingId, DriverId, PassengerId, RatingJson)
        SELECT @rating,@trip,@booking,DriverId,@passenger,JSON_MODIFY(@json,'$.driverId',DriverId) FROM dbo.Bookings
        WHERE BookingId=@booking AND TripId=@trip AND PassengerId=@passenger AND Status='confirmed'
          AND EXISTS (SELECT 1 FROM dbo.UserRecords WHERE RecordType='tracking' AND RecordId=@booking AND JSON_VALUE(RecordJson,'$.status')='completed')
        """, connection))
    {
        Add(command, "@rating", Text(rating, "id"), SqlDbType.NVarChar, 128);
        Add(command, "@trip", tripId, SqlDbType.NVarChar, 64);
        Add(command, "@booking", bookingId, SqlDbType.NVarChar, 64);
        Add(command, "@passenger", userId, SqlDbType.NVarChar, 64);
        Add(command, "@json", rating.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
        try
        {
            if (await command.ExecuteNonQueryAsync() == 0)
                throw new ApiException(403, "ÙŠÙ…ÙƒÙ† ØªÙ‚ÙŠÙŠÙ… Ø§Ù„Ø³Ø§Ø¦Ù‚ Ø¨Ø¹Ø¯ ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø­Ø¬Ø² ÙˆØ¥ÙƒÙ…Ø§Ù„ Ø§Ù„Ø±Ø­Ù„Ø© ÙÙ‚Ø·.");
        }
        catch (SqlException error) when (error.Number is 2601 or 2627)
        {
            throw new ApiException(409, "Ø³Ø¨Ù‚ Ø£Ù† Ù‚ÙŠÙ‘Ù…Øª Ù‡Ø°Ù‡ Ø§Ù„Ø±Ø­Ù„Ø©.");
        }
    }
    return Results.Created($"/api/ratings/{Text(rating, "id")}", rating);
});

app.MapPost("/api/conversations", async (HttpContext context) =>
{
    var userId = RequireUser(context);
    var body = await ReadBody(context);
    var tripId = Text(body, "tripId");
    var targetId = Text(body, "targetId");
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        SELECT BookingId, PassengerId, DriverId FROM dbo.Bookings
        WHERE TripId=@trip AND Status='confirmed'
          AND ((PassengerId=@user AND DriverId=@target) OR (DriverId=@user AND PassengerId=@target))
        """, connection);
    Add(command, "@trip", tripId, SqlDbType.NVarChar, 64);
    Add(command, "@user", userId, SqlDbType.NVarChar, 64);
    Add(command, "@target", targetId, SqlDbType.NVarChar, 64);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync()) throw new ApiException(403, "Ø§Ù„Ù…Ø±Ø§Ø³Ù„Ø© Ù…ØªØ§Ø­Ø© Ø¨Ø¹Ø¯ ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø­Ø¬Ø² Ø¨ÙŠÙ† Ø§Ù„Ø·Ø±ÙÙŠÙ†.");
    var bookingId = reader.GetString(0);
    var passengerId = reader.GetString(1);
    var driverId = reader.GetString(2);
    await reader.CloseAsync();
    var conversationId = $"{tripId}_{bookingId}";
    await using var insert = new SqlCommand("""
        IF NOT EXISTS (SELECT 1 FROM dbo.Conversations WHERE BookingId=@booking)
          INSERT INTO dbo.Conversations(ConversationId,BookingId,PassengerId,DriverId) VALUES(@id,@booking,@passenger,@driver)
        """, connection);
    Add(insert, "@id", conversationId, SqlDbType.NVarChar, 128);
    Add(insert, "@booking", bookingId, SqlDbType.NVarChar, 64);
    Add(insert, "@passenger", passengerId, SqlDbType.NVarChar, 64);
    Add(insert, "@driver", driverId, SqlDbType.NVarChar, 64);
    await insert.ExecuteNonQueryAsync();
    return Results.Ok(new { id = conversationId, bookingId, tripId, bookingStatus = "confirmed", passengerId, driverId, participantIds = new[] { passengerId, driverId } });
});

app.MapGet("/api/conversations/{id}", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        SELECT c.BookingId,c.PassengerId,c.DriverId,b.Status,b.TripId
        FROM dbo.Conversations c JOIN dbo.Bookings b ON b.BookingId=c.BookingId
        WHERE c.ConversationId=@id AND (c.PassengerId=@user OR c.DriverId=@user)
        """, connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 128);
    Add(command, "@user", userId, SqlDbType.NVarChar, 64);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync()) throw new ApiException(404, "Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø© ØºÙŠØ± Ù…ØªØ§Ø­Ø©.");
    return Results.Ok(new { id, bookingId = reader.GetString(0), passengerId = reader.GetString(1), driverId = reader.GetString(2), bookingStatus = reader.GetString(3), tripId = reader.GetString(4), participantIds = new[] { reader.GetString(1), reader.GetString(2) } });
});

app.MapGet("/api/conversations/{id}/messages", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    var messages = new List<JsonNode>();
    await using var connection = await OpenDatabase();
    await EnsureConversationParticipant(connection, id, userId);
    await using var command = new SqlCommand("SELECT MessageJson FROM dbo.Messages WHERE ConversationId=@id ORDER BY CreatedAt", connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 128);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) messages.Add(JsonNode.Parse(reader.GetString(0))!);
    return Results.Json(messages, jsonOptions);
});

app.MapPost("/api/conversations/{id}/messages", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    var body = await ReadBody(context);
    var text = Text(body, "text").Trim();
    if (text.Length is < 1 or > 2000) throw new ApiException(400, "Ø§ÙƒØªØ¨ Ø±Ø³Ø§Ù„Ø© Ù„Ø§ ØªØªØ¬Ø§ÙˆØ² 2000 Ø­Ø±Ù.");
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        SELECT c.BookingId,c.PassengerId,c.DriverId,b.Status FROM dbo.Conversations c
        JOIN dbo.Bookings b ON b.BookingId=c.BookingId
        WHERE c.ConversationId=@id AND (c.PassengerId=@user OR c.DriverId=@user)
        """, connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 128);
    Add(command, "@user", userId, SqlDbType.NVarChar, 64);
    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync()) throw new ApiException(404, "Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø© ØºÙŠØ± Ù…ØªØ§Ø­Ø©.");
    var passenger = reader.GetString(1);
    var driver = reader.GetString(2);
    if (reader.GetString(3) != "confirmed") throw new ApiException(403, "Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø© Ù„Ù„Ù‚Ø±Ø§Ø¡Ø© ÙÙ‚Ø· Ù…Ø§ Ù„Ù… ÙŠÙƒÙ† Ø§Ù„Ø­Ø¬Ø² Ù…Ø¤ÙƒØ¯Ù‹Ø§.");
    await reader.CloseAsync();
    var receiver = userId == passenger ? driver : passenger;
    var message = new JsonObject
    {
        ["id"] = Guid.NewGuid().ToString("N"),
        ["conversationId"] = id,
        ["senderId"] = userId,
        ["receiverId"] = receiver,
        ["text"] = text,
        ["createdAt"] = DateTimeOffset.UtcNow.ToString("O"),
        ["read"] = false
    };
    await using var insert = new SqlCommand("INSERT INTO dbo.Messages(MessageId,ConversationId,SenderId,ReceiverId,MessageJson) VALUES(@id,@conversation,@sender,@receiver,@json)", connection);
    Add(insert, "@id", Text(message, "id"), SqlDbType.NVarChar, 64);
    Add(insert, "@conversation", id, SqlDbType.NVarChar, 128);
    Add(insert, "@sender", userId, SqlDbType.NVarChar, 64);
    Add(insert, "@receiver", receiver, SqlDbType.NVarChar, 64);
    Add(insert, "@json", message.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
    await insert.ExecuteNonQueryAsync();
    return Results.Created($"/api/conversations/{id}/messages/{Text(message, "id")}", message);
});

app.MapPut("/api/conversations/{id}/read", async (string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    await using var connection = await OpenDatabase();
    await EnsureConversationParticipant(connection, id, userId);
    await using var command = new SqlCommand("""
        UPDATE dbo.Messages SET MessageJson=JSON_MODIFY(MessageJson,'$.read',CAST(1 AS bit))
        WHERE ConversationId=@id AND ReceiverId=@user AND JSON_VALUE(MessageJson,'$.read')='false'
        """, connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 128);
    Add(command, "@user", userId, SqlDbType.NVarChar, 64);
    await command.ExecuteNonQueryAsync();
    return Results.NoContent();
});

app.MapGet("/api/records/{type}", async (string type, HttpContext context) =>
{
    var userId = RequireUser(context);
    if (type is not ("tracking" or "location")) throw new ApiException(404, "Ù†ÙˆØ¹ Ø§Ù„Ø³Ø¬Ù„ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ.");
    var records = new List<JsonNode>();
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("SELECT RecordJson FROM dbo.UserRecords WHERE RecordType=@type AND (OwnerId=@user OR RelatedId=@user)", connection);
    Add(command, "@type", type, SqlDbType.NVarChar, 32);
    Add(command, "@user", userId, SqlDbType.NVarChar, 64);
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync()) records.Add(JsonNode.Parse(reader.GetString(0))!);
    return Results.Json(records, jsonOptions);
});

app.MapPut("/api/records/{type}/{id}", async (string type, string id, HttpContext context) =>
{
    var userId = RequireUser(context);
    if (type is not ("tracking" or "location")) throw new ApiException(404, "Ù†ÙˆØ¹ Ø§Ù„Ø³Ø¬Ù„ ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙ.");
    var record = await ReadBody(context);
    if (type == "tracking")
    {
       await using var trackingConnection = await OpenDatabase();
        await using var booking = new SqlCommand("SELECT DriverId FROM dbo.Bookings WHERE BookingId=@id AND PassengerId=@user AND Status='confirmed'", trackingConnection);
        Add(booking, "@id", id, SqlDbType.NVarChar, 64);
        Add(booking, "@user", userId, SqlDbType.NVarChar, 64);
        var driverId = await booking.ExecuteScalarAsync() as string;
        if (driverId is null) throw new ApiException(403, "Ø­Ø§Ù„Ø© Ø§Ù„ØªØªØ¨Ø¹ Ù…ØªØ§Ø­Ø© Ù„Ù„Ø±Ø§ÙƒØ¨ ØµØ§Ø­Ø¨ Ø§Ù„Ø­Ø¬Ø² Ø§Ù„Ù…Ø¤ÙƒØ¯ ÙÙ‚Ø·.");
        record["relatedId"] = driverId;
    }
    else if (Text(record, "kind") == "driver")
    {
        await using var locationConnection = await OpenDatabase();
        await using var booking = new SqlCommand("SELECT PassengerId FROM dbo.Bookings WHERE BookingId=@id AND DriverId=@user AND Status='confirmed'", locationConnection);
        Add(booking, "@id", id, SqlDbType.NVarChar, 64);
        Add(booking, "@user", userId, SqlDbType.NVarChar, 64);
        var passengerId = await booking.ExecuteScalarAsync() as string;
        if (passengerId is null) throw new ApiException(403, "Ù…ÙˆÙ‚Ø¹ Ø§Ù„Ø³Ø§Ø¦Ù‚ Ù…ØªØ§Ø­ Ø¨Ø¹Ø¯ ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ø­Ø¬Ø² ÙÙ‚Ø·.");
        record["relatedId"] = passengerId;
    }
    else
    {
        record.Remove("relatedId");
    }
    record["id"] = id;
    record["userId"] = userId;
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("""
        MERGE dbo.UserRecords WITH (HOLDLOCK) AS target
        USING (SELECT @type AS RecordType,@id AS RecordId) AS source
        ON target.RecordType=source.RecordType AND target.RecordId=source.RecordId
        WHEN MATCHED AND target.OwnerId=@owner THEN UPDATE SET RecordJson=@json, RelatedId=@related, UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT(RecordType,RecordId,OwnerId,RelatedId,RecordJson) VALUES(@type,@id,@owner,@related,@json);
        """, connection);
    Add(command, "@type", type, SqlDbType.NVarChar, 32);
    Add(command, "@id", id, SqlDbType.NVarChar, 128);
    Add(command, "@owner", userId, SqlDbType.NVarChar, 64);
    Add(command, "@related", Text(record, "relatedId"), SqlDbType.NVarChar, 128);
    Add(command, "@json", record.ToJsonString(jsonOptions), SqlDbType.NVarChar, -1);
    await command.ExecuteNonQueryAsync();
    return Results.Ok(record);
});

app.Run();

async Task<SqlConnection> OpenDatabase()
{
    if (string.IsNullOrWhiteSpace(connectionString))
        throw new ApiException(503, "Ø¥Ø¹Ø¯Ø§Ø¯ DARB_SQL_CONNECTION ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.");
    var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    return connection;
}

async Task<JsonObject> ReadBody(HttpContext context)
{
    var body = await JsonNode.ParseAsync(context.Request.Body);
    return body as JsonObject ?? throw new ApiException(400, "ØµÙŠØºØ© Ø§Ù„Ø·Ù„Ø¨ ØºÙŠØ± ØµØ§Ù„Ø­Ø©.");
}

async Task<JsonNode> LoadProfile(string id)
{
    await using var connection = await OpenDatabase();
    await using var command = new SqlCommand("SELECT ProfileJson FROM dbo.Profiles WHERE UserId=@id", connection);
    Add(command, "@id", id, SqlDbType.NVarChar, 64);
    var result = await command.ExecuteScalarAsync();
    if (result is not string json) throw new ApiException(404, "Ø§Ù„Ø­Ø³Ø§Ø¨ ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯.");
    return JsonNode.Parse(json)!;
}

string CreateToken(string id)
{
    EnsureTokenSecret();
    var secret = tokenSecret!;
    var payload = $"{id}|{DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds()}";
    var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(payload)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var signature = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(encoded))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    return $"{encoded}.{signature}";
}

string RequireUser(HttpContext context)
{
    EnsureTokenSecret();
    var header = context.Request.Headers.Authorization.ToString();
    if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        throw new ApiException(401, "Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù„Ù„Ù…ØªØ§Ø¨Ø¹Ø©.");
    var parts = header[7..].Split('.');
    if (parts.Length != 2) throw new ApiException(401, "Ø§Ù†ØªÙ‡Øª Ø§Ù„Ø¬Ù„Ø³Ø©. Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ù‹Ø§.");
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(tokenSecret));
    var expected = Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(parts[0]))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(parts[1])))
        throw new ApiException(401, "Ø§Ù†ØªÙ‡Øª Ø§Ù„Ø¬Ù„Ø³Ø©. Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ù‹Ø§.");
    try
    {
        var payload = Encoding.UTF8.GetString(Convert.FromBase64String(parts[0].Replace('-', '+').Replace('_', '/') + new string('=', (4 - parts[0].Length % 4) % 4)));
        var fields = payload.Split('|');
        if (fields.Length != 2 || !long.TryParse(fields[1], out var expires) || expires <= DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            throw new ApiException(401, "Ø§Ù†ØªÙ‡Øª Ø§Ù„Ø¬Ù„Ø³Ø©. Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ù‹Ø§.");
        return fields[0];
    }
    catch (FormatException)
    {
        throw new ApiException(401, "Ø§Ù†ØªÙ‡Øª Ø§Ù„Ø¬Ù„Ø³Ø©. Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ù…Ø¬Ø¯Ø¯Ù‹Ø§.");
    }
}

void EnsureTokenSecret()
{
    if (string.IsNullOrWhiteSpace(tokenSecret) || tokenSecret.Length < 32)
        throw new ApiException(503, "Ø¹ÙŠÙ‘Ù† DARB_TOKEN_SECRET Ø¥Ù„Ù‰ Ø³Ø± Ø¹Ø´ÙˆØ§Ø¦ÙŠ Ù„Ø§ ÙŠÙ‚Ù„ Ø¹Ù† 32 Ø­Ø±ÙÙ‹Ø§.");
}

async Task EnsureConversationParticipant(SqlConnection connection, string conversationId, string userId)
{
    await using var command = new SqlCommand("SELECT COUNT(1) FROM dbo.Conversations WHERE ConversationId=@id AND (PassengerId=@user OR DriverId=@user)", connection);
    Add(command, "@id", conversationId, SqlDbType.NVarChar, 128);
    Add(command, "@user", userId, SqlDbType.NVarChar, 64);
    if ((int)await command.ExecuteScalarAsync()! == 0) throw new ApiException(403, "Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ ØµÙ„Ø§Ø­ÙŠØ© Ù„Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø©.");
}

JsonNode PublicProfile(JsonNode profile, string id, bool includePhoto = true)
{
    var result = profile.DeepClone().AsObject();
    foreach (var field in new[] { "email", "phone", "password", "passwordHash", "passwordSalt", "plateNumber" })
        result.Remove(field);
    if (!includePhoto) result.Remove("profilePhoto");
    result["id"] = id;
    return result;
}

void Add(SqlCommand command, string name, object value, SqlDbType type, int size = 0)
{
    var parameter = command.Parameters.Add(name, type);
    if (size != 0) parameter.Size = size;
    parameter.Value = value ?? DBNull.Value;
}

byte[] HashPassword(string password, byte[] salt) =>
    Rfc2898DeriveBytes.Pbkdf2(password, salt, 210_000, HashAlgorithmName.SHA256, 32);

string Text(JsonNode? node, string name) => node?[name]?.GetValue<string>() ?? "";
int Integer(JsonNode? node, string name) => int.TryParse(node?[name]?.ToString(), out var value) ? value : 0;
decimal Number(JsonNode? node, string name) =>
    decimal.TryParse(node?[name]?.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var value) ? value : 0;
bool Boolean(JsonNode? node, string name) => bool.TryParse(node?[name]?.ToString(), out var value) && value;

sealed class ApiException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}



