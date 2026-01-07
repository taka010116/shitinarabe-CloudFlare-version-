from PIL import Image

# 読み込み（RGBA に変換してアルファを確実に扱う）
orig = Image.open("D1.png").convert("RGBA")

# 塗りつぶし色（短縮 #0a3 -> フル #00aa33）
fill_color = "#00aa33"

# 同じサイズの単色画像を作る
color_img = Image.new("RGBA", orig.size, fill_color)

# 元のアルファを取り出して、新しい画像にアルファとしてセット
alpha = orig.getchannel("A")  # 元画像にアルファがない場合は全不透明になる
color_img.putalpha(alpha)

# 保存（PNG で透過を保持）
color_img.save("Blank.png")
