-- Server-only ciphertext. Deliberately absent from Better Auth's public schema.
-- Account erasure's existing account FK/triggers cover this column too.
ALTER TABLE account ADD COLUMN nativeGrant TEXT;
