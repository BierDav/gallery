/**
Comments and likes ("activity") on every album, not only on albums shared
with another user.

Upstream shows the activity button and panel only when
`album.albumUsers.length > 1`. Every album has one album_user row for its
owner, so private albums and albums handed out only by share link never
qualify. The server already lets any album member, the owner included, post
when the album has activity enabled, so this client gate is all that is
needed. The purely cosmetic "this album is shared" chrome (member avatars,
"Shared by") keeps upstream's `> 1` test.
*/
export const hasAlbumActivity = (album: { albumUsers: unknown[] }) => album.albumUsers.length > 0;
