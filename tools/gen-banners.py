# Genera los banners que Chrome muestra grandes debajo del texto del aviso.
# Relacion 2:1 (Chrome recorta a eso). Colores de la app: fondo oscuro + dorado.
from PIL import Image, ImageDraw, ImageFont

W, H = 1024, 512
FONDO = (14, 14, 16)
DORADO = (200, 150, 90)
DORADO_CLARO = (212, 167, 106)
BLANCO = (242, 242, 247)
GRIS = (140, 140, 148)
VERDE = (52, 211, 153)

BOLD = 'C:/Windows/Fonts/segoeuib.ttf'
REG = 'C:/Windows/Fonts/segoeui.ttf'


def banner(archivo, titulo, subtitulo, acento, icono_barras):
    img = Image.new('RGB', (W, H), FONDO)
    d = ImageDraw.Draw(img)

    # Franja de color arriba
    d.rectangle([0, 0, W, 14], fill=acento)

    # Marca
    f_marca = ImageFont.truetype(BOLD, 34)
    d.text((60, 58), 'TECHPOINT', font=f_marca, fill=DORADO)
    d.text((60 + d.textlength('TECHPOINT', font=f_marca) + 18, 62),
           'servicio técnico', font=ImageFont.truetype(REG, 26), fill=GRIS)

    # Titulo grande
    f_tit = ImageFont.truetype(BOLD, 92)
    d.text((60, 150), titulo, font=f_tit, fill=BLANCO)

    # Subtitulo
    d.text((60, 268), subtitulo, font=ImageFont.truetype(REG, 40), fill=GRIS)

    # Barra de progreso decorativa, igual a la del tablero
    y = 380
    ancho_seg = (W - 120 - 7 * 14) // 8
    for i in range(8):
        x = 60 + i * (ancho_seg + 14)
        if i < icono_barras:
            color, alto = VERDE, 18
        elif i == icono_barras:
            color, alto = acento, 34
        else:
            color, alto = (44, 44, 48), 18
        d.rounded_rectangle([x, y + (34 - alto), x + ancho_seg, y + 34],
                            radius=alto // 2, fill=color)

    img.save(archivo, 'PNG', optimize=True)
    print(archivo, img.size)


banner('C:/Users/alan1/Documents/scf/push-nuevo.png',
       'EQUIPO NUEVO', 'Entró un equipo al taller', DORADO_CLARO, 0)
banner('C:/Users/alan1/Documents/scf/push-estado.png',
       'CAMBIO DE ESTADO', 'Un equipo avanzó de fase', (96, 165, 250), 4)
