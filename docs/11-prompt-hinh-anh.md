# 11. Prompt tạo hình bằng Gemini, đợt 1

Mỗi khối code dưới đây là **một prompt hoàn chỉnh**. Bạn copy nguyên khối, dán vào Gemini, chờ ra ảnh, rồi tải ảnh về.

## Cách làm
1. Mở một **cuộc trò chuyện mới** trong Gemini cho đợt này, để mọi hình giữ cùng phong cách.
2. Dán lần lượt từng prompt, từ số 1 trở đi.
3. Nếu Gemini trả lời bằng chữ mà không ra ảnh: đổi chế độ sang **Tự động**, hoặc chọn công cụ **Tạo hình ảnh**, rồi dán lại.
4. Nếu ảnh chưa ưng, gõ thêm một câu sửa ngắn ngay sau đó, ví dụ: "Make the silhouette simpler and bolder".
5. Lưu ảnh vào thư mục `assets/goc/` trong dự án, **đúng tên file ghi ở mỗi prompt**. Lưu thiếu thì cũng không sao.
6. Xong thì báo mình. Mình sẽ tách nền, thu nhỏ và đưa vào game.

Ghi chú:
- Prompt viết bằng tiếng Anh vì mô hình tạo ảnh thường bám mô tả tiếng Anh sát hơn.
- Nền **màu hồng tím phẳng #FF00FF** là có chủ ý. Mình dùng màu này để tách nền, vì Gemini thường không xuất được nền trong suốt.

---

## Nhân vật: 4 cung (dùng trong trận và trên bản đồ)

### 1. Bạch Dương → `nv_bach_duong.png`
```
Create an image. Original 2D game character sprite for a turn-based artillery game with a cosmic "star hunter" theme.

Character: a young star hunter of the Aries constellation. Bold and reckless personality. Red-orange light armor with small curled ram-horn shapes on the helmet, gold star accents. Holding a short, chunky hand cannon with a wide barrel, pointed forward.

Style: chibi proportions (big head, small body, about 2.5 heads tall), clean thick dark outlines, flat cel shading with 2-3 tones per color, bright saturated colors, very readable silhouette that still reads clearly when shrunk to 32 pixels tall. Few small details.

Pose: full body, standing, side view facing RIGHT, feet at the bottom of the frame, centered.
Background: solid flat pure magenta #FF00FF, no gradient, no ground, no shadow, no floor.
No text, no letters, no logo, no watermark, no frame. Do not imitate any existing game, anime or brand character.
Square image, 1024x1024.
```

### 2. Kim Ngưu → `nv_kim_nguu.png`
```
Create an image. Original 2D game character sprite for a turn-based artillery game with a cosmic "star hunter" theme.

Character: a young star hunter of the Taurus constellation. Sturdy, calm, unshakeable. Heavy rounded armor in earthy green and bronze, two short bull horns on the helmet, a small round shield strapped to the left forearm, gold star accents. Holding a compact submachine gun pointed forward.

Style: chibi proportions (big head, small body, about 2.5 heads tall), clean thick dark outlines, flat cel shading with 2-3 tones per color, bright saturated colors, very readable silhouette that still reads clearly when shrunk to 32 pixels tall. Few small details. Looks broader and heavier than a normal character.

Pose: full body, standing firmly, side view facing RIGHT, feet at the bottom of the frame, centered.
Background: solid flat pure magenta #FF00FF, no gradient, no ground, no shadow, no floor.
No text, no letters, no logo, no watermark, no frame. Do not imitate any existing game, anime or brand character.
Square image, 1024x1024.
```

### 3. Xử Nữ → `nv_xu_nu.png`
```
Create an image. Original 2D game character sprite for a turn-based artillery game with a cosmic "star hunter" theme.

Character: a young star hunter of the Virgo constellation. Precise, meticulous, calm. Sleek fitted outfit in white, silver and pale ice blue, a small glowing monocle scope over one eye, a short cape, gold star accents. Holding a long slim rifle with a scope, pointed forward.

Style: chibi proportions (big head, small body, about 2.5 heads tall), clean thick dark outlines, flat cel shading with 2-3 tones per color, bright saturated colors, very readable silhouette that still reads clearly when shrunk to 32 pixels tall. Few small details.

Pose: full body, standing, side view facing RIGHT, feet at the bottom of the frame, centered.
Background: solid flat pure magenta #FF00FF, no gradient, no ground, no shadow, no floor.
No text, no letters, no logo, no watermark, no frame. Do not imitate any existing game, anime or brand character.
Square image, 1024x1024.
```

### 4. Bảo Bình → `nv_bao_binh.png`
```
Create an image. Original 2D game character sprite for a turn-based artillery game with a cosmic "star hunter" theme.

Character: a young star hunter of the Aquarius constellation. Creative and dreamy. A flowing coat in teal and violet with swirling water-and-starlight patterns, a hood with a small star-shaped clasp, gold star accents. Holding a wide-mouthed star cannon that glows softly at the muzzle, pointed forward.

Style: chibi proportions (big head, small body, about 2.5 heads tall), clean thick dark outlines, flat cel shading with 2-3 tones per color, bright saturated colors, very readable silhouette that still reads clearly when shrunk to 32 pixels tall. Few small details.

Pose: full body, standing, side view facing RIGHT, feet at the bottom of the frame, centered.
Background: solid flat pure magenta #FF00FF, no gradient, no ground, no shadow, no floor.
No text, no letters, no logo, no watermark, no frame. Do not imitate any existing game, anime or brand character.
Square image, 1024x1024.
```

---

## Quái: sinh vật Ám Thạch

### 5. Ám Thạch Nhỏ → `quai_am_thach_nho.png`
```
Create an image. Original 2D game monster sprite, same art style as a chibi cosmic star-hunter game: clean thick dark outlines, flat cel shading, bright readable colors.

Monster: "Dark Shard Small", a small creature made of dark purple-black crystal rock that fell from the sky. Round chunky body, two stubby legs, glowing red cracks and two glowing red eyes. A bit cute but clearly hostile. A small crystal spike on its back that it throws like a stone.

Style: very readable silhouette that still reads clearly when shrunk to 32 pixels tall, few small details.
Pose: full body, side view facing RIGHT, feet at the bottom of the frame, centered.
Background: solid flat pure magenta #FF00FF, no gradient, no ground, no shadow.
No text, no logo, no watermark. Do not imitate any existing game or brand monster.
Square image, 1024x1024.
```

### 6. Ám Thạch Gai → `quai_am_thach_gai.png`
```
Create an image. Original 2D game monster sprite, same art style as a chibi cosmic star-hunter game: clean thick dark outlines, flat cel shading, bright readable colors.

Monster: "Dark Shard Spiker", a nimble creature of dark crystal covered in sharp spikes, with glowing orange lava cracks and orange eyes. Four short quick legs, looks agile and aggressive. Small flames flicker at the tips of a few spikes.

Style: very readable silhouette that still reads clearly when shrunk to 32 pixels tall, few small details.
Pose: full body, side view facing RIGHT, feet at the bottom of the frame, centered.
Background: solid flat pure magenta #FF00FF, no gradient, no ground, no shadow.
No text, no logo, no watermark. Do not imitate any existing game or brand monster.
Square image, 1024x1024.
```

### 7. Ám Thạch Lớn → `quai_am_thach_lon.png`
```
Create an image. Original 2D game monster sprite, same art style as a chibi cosmic star-hunter game: clean thick dark outlines, flat cel shading, bright readable colors.

Monster: "Dark Shard Giant", a big hulking golem made of stacked dark violet crystal boulders, glowing deep purple core in its chest, small glowing eyes, huge heavy arms, one fist holding a boulder ready to throw. Looks slow, heavy and powerful.

Style: very readable silhouette that still reads clearly when shrunk to 48 pixels tall, few small details.
Pose: full body, side view facing RIGHT, feet at the bottom of the frame, centered, filling most of the frame.
Background: solid flat pure magenta #FF00FF, no gradient, no ground, no shadow.
No text, no logo, no watermark. Do not imitate any existing game or brand monster.
Square image, 1024x1024.
```

---

## Địa hình và nền trận (nhìn ngang)

### 8. Đất trong trận → `dat_tran.png`
```
Create an image. A seamless tileable 2D game texture of underground soil and rock for a side-view artillery game with a cosmic theme: dark brown earth with small embedded stones and a few tiny faintly glowing blue star crystals. Flat 2D cartoon style, simple shapes, low detail, readable at small size.
The texture must tile seamlessly on all four edges. Even lighting, no shadows from a light source, no perspective, viewed straight on.
No text, no logo, no watermark. Square image, 1024x1024.
```

### 9. Mép cỏ trên mặt đất → `mep_co.png`
```
Create an image. A seamless horizontally-tileable 2D game texture strip: the top edge of the ground in a side-view artillery game with a cosmic theme. A band of short blue-green grass with tiny glowing star flowers on top of a thin layer of dark soil. Flat 2D cartoon style, clean dark outline along the top of the grass, low detail.
The strip must tile seamlessly left to right. The area above the grass is solid flat pure magenta #FF00FF. Even lighting, viewed straight from the side.
No text, no logo, no watermark. Wide image, 1024x256.
```

### 10. Nền trời Đồng Ám Thạch → `nen_dong_am_thach.png`
```
Create an image. A 2D game background for a side-view artillery battle on an open plain at night under a magical starry sky. Deep navy-to-indigo gradient sky full of stars, faint glowing constellation lines, a few distant purple crystal shards sticking out of far-away hills on the horizon. Calm, soft, slightly blurred so foreground characters stay readable. Flat 2D cartoon style.
Keep the bottom 30 percent simple and dark (it will be covered by the ground). No characters, no text, no logo, no watermark.
Wide image, 1920x1080.
```

### 11. Nền trời Hẻm Vẫn Thạch → `nen_hem_van_thach.png`
```
Create an image. A 2D game background for a side-view artillery battle inside a deep canyon at dusk. Tall dark rock cliffs on both far sides, a narrow slice of starry violet-orange sky above, glowing orange meteor streaks crossing the sky, small floating rock fragments. Calm, slightly blurred so foreground characters stay readable. Flat 2D cartoon style, matching a cosmic star-hunter game.
Keep the bottom 30 percent simple and dark. No characters, no text, no logo, no watermark.
Wide image, 1920x1080.
```

### 12. Nền đấu trường → `nen_dau_truong.png`
```
Create an image. A 2D game background for a side-view one-on-one duel arena floating in space. Deep space with a large softly glowing nebula, a ring of floating stone pillars engraved with constellation symbols in the distance, golden starlight. Symmetrical composition left to right. Calm, slightly blurred so foreground characters stay readable. Flat 2D cartoon style, matching a cosmic star-hunter game.
Keep the bottom 30 percent simple and dark. No characters, no text, no logo, no watermark.
Wide image, 1920x1080.
```

---

## Bản đồ thế giới (nhìn từ trên xuống)

### 13. Ba ô nền thế giới → `o_the_gioi.png`
```
Create an image. A 2D top-down game tile sheet with exactly THREE square tiles side by side, in a row, with a small gap of solid flat pure magenta #FF00FF between and around them:
1) left: city floor, smooth pale stone slabs with tiny gold star inlays;
2) middle: hunting-ground floor, short blue-green grass with a few tiny pebbles;
3) right: wall/obstacle, dark violet crystal rock seen from above, clearly blocking.
Each tile must be seamlessly tileable with itself on all four edges. Flat 2D cartoon style, low detail, readable at 32x32 pixels, viewed straight from above, even lighting.
No text, no logo, no watermark. Wide image, 1536x512.
```

### 14. Cổng dịch chuyển → `cong.png`
```
Create an image. A 2D top-down game sprite of a teleport portal on the ground: a circle of glowing golden star runes around a swirling deep-blue light, a few sparkles. Flat 2D cartoon style, clean dark outline, readable at 64x64 pixels, viewed straight from above.
Background: solid flat pure magenta #FF00FF, no shadow. No text, no logo, no watermark.
Square image, 1024x1024.
```

---

Đợt sau (khi đợt 1 đã vào game): biểu tượng cho 22 khẩu súng, hiệu ứng nổ/cháy/băng/độc, khung giao diện.
