-- Extend the preset allowlist only. Membership checks and saved choices stay intact.
begin;
alter table public.org_members drop constraint if exists org_members_avatar_preset;
alter table public.org_members add constraint org_members_avatar_preset check (
  avatar is null or avatar in (
    '/avatars/sun.svg','/avatars/mint.svg','/avatars/coral.svg','/avatars/sky.svg',
    '/avatars/lilac.svg','/avatars/peach.svg','/avatars/slate.svg','/avatars/sage.svg',
    '/avatars/sunburst.svg','/avatars/triangle.svg'
  ) or avatar ~ '^/avatars/blobatar/(round|organic|boxy|capsule|nub|cloud|droplet|hexagon|sunburst|triangle)-(sun|mint|coral|sky|lilac|peach|slate|sage|amber|rose)[.]svg$'
    or avatar ~ '^/avatars/mascots/(bear|bunny|cat|deer|dino|fox|frog|hamster|hedgehog|koala|mouse|otter|owl|panda|penguin|pug|raccoon|redpanda|sheep|sloth|tiger|afro|astronaut|bald|ballerina|beard|builder|cap|chef|glasses|grandpa|granny|hijabi|kamran|nurse|pirate|scientist|sikh|skater|wizard|clockwork|crt|cube|drone|gearbot|knight|lantern|postbot|radio|rocket|scout|toaster|tv)[.]webp$'
);
comment on constraint org_members_avatar_preset on public.org_members is
  'Exact bundled Filey, Blobatar or Page Mascot portraits only; no external URLs or sprite sheets.';
notify pgrst, 'reload schema';
commit;
