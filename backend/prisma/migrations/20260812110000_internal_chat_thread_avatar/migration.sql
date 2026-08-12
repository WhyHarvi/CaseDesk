-- Group photo for internal chat threads, same storage pattern already used
-- for user profile avatars (avatar_storage_key/avatar_mime_type on users).
ALTER TABLE "internal_chat_threads" ADD COLUMN "avatar_storage_key" TEXT;
ALTER TABLE "internal_chat_threads" ADD COLUMN "avatar_mime_type" TEXT;
