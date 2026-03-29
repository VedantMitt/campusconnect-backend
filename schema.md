ACTIVITIES:
id:uuid
title:text
type:text
date:timestamp without time zone
location:text
created_at:timestamp without time zone
description:text
banner:text
mode:text
host_id:uuid
join_deadline:timestamp without time zone
submission_deadline:timestamp without time zone

ACTIVITY_MEMBERS:
id:uuid
activity_id:uuid
user_id:uuid
joined_at:timestamp without time zone

TABLES:
activities
activity_members
blocks
conversations
friends
messages
notifications
otp_codes
reports
room_members
rooms
submissions
users
votes

SUBMISSIONS:
id:uuid
activity_id:uuid
user_id:uuid
content_url:text
description:text
created_at:timestamp without time zone

USERS:
instance_id:uuid
id:uuid
name:text
id:uuid
email:text
aud:character varying
role:character varying
college:text
email:character varying
created_at:timestamp without time zone
skills:ARRAY
encrypted_password:character varying
email_confirmed_at:timestamp with time zone
interests:ARRAY
profile_pic:text
invited_at:timestamp with time zone
confirmation_token:character varying
username:text
confirmation_sent_at:timestamp with time zone
bio:text
branch:text
recovery_token:character varying
year:text
recovery_sent_at:timestamp with time zone
instagram:text
email_change_token_new:character varying
linkedin:text
email_change:character varying
is_private:boolean
email_change_sent_at:timestamp with time zone
last_sign_in_at:timestamp with time zone
password_hash:text
is_verified:boolean
raw_app_meta_data:jsonb
raw_user_meta_data:jsonb
vibe_tags:ARRAY
is_super_admin:boolean
current_status:text
friends_if:text
created_at:timestamp with time zone
status_updated_at:timestamp without time zone
updated_at:timestamp with time zone
phone:text
phone_confirmed_at:timestamp with time zone
phone_change:text
phone_change_token:character varying
phone_change_sent_at:timestamp with time zone
confirmed_at:timestamp with time zone
email_change_token_current:character varying
email_change_confirm_status:smallint
banned_until:timestamp with time zone
reauthentication_token:character varying
reauthentication_sent_at:timestamp with time zone
is_sso_user:boolean
deleted_at:timestamp with time zone
is_anonymous:boolean

