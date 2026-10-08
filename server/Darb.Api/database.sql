CREATE TABLE dbo.Profiles (
    UserId nvarchar(64) NOT NULL PRIMARY KEY,
    Email nvarchar(320) NOT NULL UNIQUE,
    Phone nvarchar(32) NOT NULL UNIQUE,
    Username nvarchar(20) NOT NULL UNIQUE,
    PasswordSalt varbinary(16) NOT NULL,
    PasswordHash varbinary(32) NOT NULL,
    ProfileJson nvarchar(max) NOT NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_Profiles_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_Profiles_ProfileJson CHECK (ISJSON(ProfileJson) = 1)
);

CREATE TABLE dbo.Trips (
    TripId nvarchar(64) NOT NULL PRIMARY KEY,
    DriverId nvarchar(64) NOT NULL,
    Status nvarchar(24) NOT NULL,
    AvailableSeats int NOT NULL,
    TripJson nvarchar(max) NOT NULL,
    CONSTRAINT FK_Trips_Profiles FOREIGN KEY (DriverId) REFERENCES dbo.Profiles(UserId),
    CONSTRAINT CK_Trips_Seats CHECK (AvailableSeats >= 0),
    CONSTRAINT CK_Trips_Json CHECK (ISJSON(TripJson) = 1)
);
CREATE INDEX IX_Trips_Status ON dbo.Trips(Status);

CREATE TABLE dbo.Bookings (
    BookingId nvarchar(64) NOT NULL PRIMARY KEY,
    TripId nvarchar(64) NOT NULL,
    PassengerId nvarchar(64) NOT NULL,
    DriverId nvarchar(64) NOT NULL,
    Status nvarchar(24) NOT NULL,
    BookingJson nvarchar(max) NOT NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_Bookings_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Bookings_Trips FOREIGN KEY (TripId) REFERENCES dbo.Trips(TripId),
    CONSTRAINT FK_Bookings_Passenger FOREIGN KEY (PassengerId) REFERENCES dbo.Profiles(UserId),
    CONSTRAINT FK_Bookings_Driver FOREIGN KEY (DriverId) REFERENCES dbo.Profiles(UserId),
    CONSTRAINT CK_Bookings_Json CHECK (ISJSON(BookingJson) = 1)
);
CREATE INDEX IX_Bookings_Passenger ON dbo.Bookings(PassengerId, CreatedAt DESC);
CREATE INDEX IX_Bookings_Driver ON dbo.Bookings(DriverId, CreatedAt DESC);

CREATE TABLE dbo.Follows (
    FollowerId nvarchar(64) NOT NULL,
    FollowingId nvarchar(64) NOT NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_Follows_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Follows PRIMARY KEY (FollowerId, FollowingId),
    CONSTRAINT FK_Follows_Follower FOREIGN KEY (FollowerId) REFERENCES dbo.Profiles(UserId),
    CONSTRAINT FK_Follows_Following FOREIGN KEY (FollowingId) REFERENCES dbo.Profiles(UserId),
    CONSTRAINT CK_Follows_NotSelf CHECK (FollowerId <> FollowingId)
);

CREATE TABLE dbo.Ratings (
    RatingId nvarchar(128) NOT NULL PRIMARY KEY,
    TripId nvarchar(64) NOT NULL,
    BookingId nvarchar(64) NOT NULL,
    DriverId nvarchar(64) NOT NULL,
    PassengerId nvarchar(64) NOT NULL,
    RatingJson nvarchar(max) NOT NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_Ratings_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Ratings_TripPassenger UNIQUE (TripId, PassengerId),
    CONSTRAINT FK_Ratings_Booking FOREIGN KEY (BookingId) REFERENCES dbo.Bookings(BookingId),
    CONSTRAINT CK_Ratings_Json CHECK (ISJSON(RatingJson) = 1)
);
CREATE INDEX IX_Ratings_Driver ON dbo.Ratings(DriverId, CreatedAt DESC);

CREATE TABLE dbo.Conversations (
    ConversationId nvarchar(128) NOT NULL PRIMARY KEY,
    BookingId nvarchar(64) NOT NULL UNIQUE,
    PassengerId nvarchar(64) NOT NULL,
    DriverId nvarchar(64) NOT NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_Conversations_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Conversations_Booking FOREIGN KEY (BookingId) REFERENCES dbo.Bookings(BookingId)
);

CREATE TABLE dbo.Messages (
    MessageId nvarchar(64) NOT NULL PRIMARY KEY,
    ConversationId nvarchar(128) NOT NULL,
    SenderId nvarchar(64) NOT NULL,
    ReceiverId nvarchar(64) NOT NULL,
    MessageJson nvarchar(max) NOT NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_Messages_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Messages_Conversation FOREIGN KEY (ConversationId) REFERENCES dbo.Conversations(ConversationId),
    CONSTRAINT CK_Messages_Json CHECK (ISJSON(MessageJson) = 1)
);
CREATE INDEX IX_Messages_Conversation ON dbo.Messages(ConversationId, CreatedAt);

CREATE TABLE dbo.Notifications (
    NotificationId nvarchar(64) NOT NULL PRIMARY KEY,
    UserId nvarchar(64) NOT NULL,
    Message nvarchar(500) NOT NULL,
    CreatedAt datetime2 NOT NULL CONSTRAINT DF_Notifications_CreatedAt DEFAULT SYSUTCDATETIME(),
    IsRead bit NOT NULL CONSTRAINT DF_Notifications_IsRead DEFAULT 0,
    CONSTRAINT FK_Notifications_Profiles FOREIGN KEY (UserId) REFERENCES dbo.Profiles(UserId)
);
CREATE INDEX IX_Notifications_User ON dbo.Notifications(UserId, CreatedAt DESC);

CREATE TABLE dbo.UserRecords (
    RecordType nvarchar(32) NOT NULL,
    RecordId nvarchar(128) NOT NULL,
    OwnerId nvarchar(64) NOT NULL,
    RelatedId nvarchar(128) NULL,
    RecordJson nvarchar(max) NOT NULL,
    UpdatedAt datetime2 NOT NULL CONSTRAINT DF_UserRecords_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_UserRecords PRIMARY KEY (RecordType, RecordId),
    CONSTRAINT FK_UserRecords_Owner FOREIGN KEY (OwnerId) REFERENCES dbo.Profiles(UserId),
    CONSTRAINT CK_UserRecords_Json CHECK (ISJSON(RecordJson) = 1)
);
CREATE INDEX IX_UserRecords_OwnerType ON dbo.UserRecords(OwnerId, RecordType, UpdatedAt DESC);
