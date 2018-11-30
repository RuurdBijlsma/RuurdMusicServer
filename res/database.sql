DROP TABLE IF EXISTS songs, users, usersongs;

create table songs
(
  ytid      text not null
    constraint song_pkey
      primary key,
  title       text not null,
  artist      text not null,
  thumbnail   text,
  viewcount bigint,
  duration    integer
);

create table users
(
  id       serial not null
    constraint user_pkey
      primary key,
  name     text   not null,
  password text   not null
);

create table usersongs
(
  userid integer not null
    constraint table_name_userid_fkey
      references users,
  songid text    not null
    constraint table_name_songid_fkey
      references songs,
  added  timestamp,
  constraint usersongs_pk
    primary key (userid, songid)
);

insert into users(name, password) values ('default','user')
