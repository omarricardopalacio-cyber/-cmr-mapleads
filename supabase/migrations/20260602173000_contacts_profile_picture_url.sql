-- Add profile_picture_url column to contacts table
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Add comment to document the column
COMMENT ON COLUMN contacts.profile_picture_url IS 'URL of the contact profile picture from WhatsApp';
