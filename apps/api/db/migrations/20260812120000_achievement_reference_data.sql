-- migrate:up

-- These rows are product reference data, not DEV seed data. A clean migrated database must
-- preserve the same achievement and wardrobe gate as an upgraded installation.
INSERT INTO public.achievements (id, slug, title, description)
VALUES (
    '7e9dfbf6-6c20-4f09-88cf-b923da71f8da',
    'first_make',
    'Первый Make',
    'Опубликован первый Make — печать реального объекта.'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.wardrobe_rewards (achievement_id, layer, option_id)
SELECT id, 'outfit', 'apron'
FROM public.achievements
WHERE slug = 'first_make'
ON CONFLICT (achievement_id) DO NOTHING;

-- migrate:down

DELETE FROM public.wardrobe_rewards
WHERE achievement_id = '7e9dfbf6-6c20-4f09-88cf-b923da71f8da';

DELETE FROM public.achievements
WHERE id = '7e9dfbf6-6c20-4f09-88cf-b923da71f8da';
