"""
Gera docs/PIPELINE_BPMN.png — fluxograma BPMN das 22 etapas do pipeline
Lightwall, com 3 raias (Cliente / Server / cv-service). Sem chromium, sem
graphviz — pure Pillow.

Notacao BPMN usada:
  - Start event:    circulo fino verde
  - End event:      circulo grosso vermelho/cinza
  - Task:           retangulo de cantos arredondados, fundo branco
  - Subprocess:     retangulo com pequeno [+] no rodape
  - Gateway X:      diamante com 'X' (exclusivo)
  - Gateway +:      diamante com '+' (paralelo)
  - Sequence flow:  seta solida
  - Message flow:   seta tracejada (entre raias)
  - Pool/Lane:      retangulo grande com label vertical na borda esquerda
"""
from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


# ============================================================
# Estilo (cores da marca Lightwall)
# ============================================================

CYAN = "#189cd9"
ANIL = "#3d68ab"
GRAFITE = "#1e1e1c"
GREEN = "#16a34a"
RED = "#dc2626"
ORANGE = "#f59e0b"
PURPLE = "#7c3aed"
MUTED = "#6b7280"
LANE_BG = "#fafbfc"
LANE_HEADER = "#3d68ab"
LANE_HEADER_ALT = "#189cd9"
LANE_HEADER_CV = "#7c3aed"
TASK_BG = "#ffffff"
SUBPROC_BG = "#eff6ff"
GATEWAY_BG = "#fef3c7"
BG = "#ffffff"

# Larguras de stroke
LANE_BORDER_W = 2
TASK_BORDER_W = 2
SUBPROC_BORDER_W = 3
EVENT_THIN_W = 3
EVENT_THICK_W = 5
FLOW_W = 2


# ============================================================
# Fonts
# ============================================================

def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/calibrib.ttf" if bold else "C:/Windows/Fonts/calibri.ttf",
        "C:/Windows/Fonts/arial.ttf" if not bold else "C:/Windows/Fonts/arialbd.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


# ============================================================
# Layout — primitivas
# ============================================================

@dataclass
class Node:
    kind: str  # "start" | "end" | "task" | "subproc" | "gateway"
    label: str
    x: int
    y: int
    w: int = 220
    h: int = 60
    gateway_marker: str = ""  # "X" ou "+"
    sub_label: str = ""  # subtitulo pequeno em italic
    accent: str = CYAN  # cor da borda/destaque

    def cx(self) -> int:
        return self.x + self.w // 2

    def cy(self) -> int:
        return self.y + self.h // 2

    def top(self) -> tuple[int, int]:
        return (self.cx(), self.y)

    def bottom(self) -> tuple[int, int]:
        return (self.cx(), self.y + self.h)

    def left(self) -> tuple[int, int]:
        return (self.x, self.cy())

    def right(self) -> tuple[int, int]:
        return (self.x + self.w, self.cy())


def draw_node(draw: ImageDraw.ImageDraw, n: Node, font: ImageFont.FreeTypeFont, font_small: ImageFont.FreeTypeFont):
    if n.kind in ("start", "end"):
        # Eventos: circulo
        radius = min(n.w, n.h) // 2
        cx, cy = n.cx(), n.cy()
        bbox = [cx - radius, cy - radius, cx + radius, cy + radius]
        if n.kind == "start":
            draw.ellipse(bbox, outline=GREEN, fill="#dcfce7", width=EVENT_THIN_W)
        else:
            draw.ellipse(bbox, outline=GRAFITE, fill="#f3f4f6", width=EVENT_THICK_W)
        # Label fora do circulo (abaixo)
        _draw_centered_text(draw, n.label, cx, cy + radius + 14, font_small, fill=GRAFITE)
        return

    if n.kind == "gateway":
        # Diamante
        cx, cy = n.cx(), n.cy()
        half = min(n.w, n.h) // 2
        pts = [(cx, cy - half), (cx + half, cy), (cx, cy + half), (cx - half, cy)]
        draw.polygon(pts, outline=ORANGE, fill=GATEWAY_BG)
        # Borda manual com width
        for i in range(len(pts)):
            draw.line([pts[i], pts[(i + 1) % len(pts)]], fill=ORANGE, width=TASK_BORDER_W)
        # Marcador X ou +
        if n.gateway_marker:
            marker_font = load_font(28, bold=True)
            _draw_centered_text(draw, n.gateway_marker, cx, cy - 18, marker_font, fill=GRAFITE)
        # Label abaixo
        _draw_centered_text(draw, n.label, cx, cy + half + 10, font_small, fill=GRAFITE)
        return

    # Task ou Subprocess
    bg = SUBPROC_BG if n.kind == "subproc" else TASK_BG
    border_w = SUBPROC_BORDER_W if n.kind == "subproc" else TASK_BORDER_W
    border = n.accent
    draw.rounded_rectangle(
        [n.x, n.y, n.x + n.w, n.y + n.h],
        radius=10,
        outline=border,
        fill=bg,
        width=border_w,
    )
    # Texto principal centrado (com wrap simples)
    _draw_wrapped_text(draw, n.label, n.x + 10, n.y + 8, n.w - 20, n.h - 16, font, fill=GRAFITE)
    # Sub-label opcional embaixo
    if n.sub_label:
        _draw_centered_text(draw, n.sub_label, n.cx(), n.y + n.h - 14, font_small, fill=MUTED, italic=True)
    if n.kind == "subproc":
        # Marker [+] no rodape centro
        plus_size = 14
        pad = 4
        px = n.cx() - plus_size // 2
        py = n.y + n.h - plus_size - 4
        draw.rectangle([px, py, px + plus_size, py + plus_size], outline=border, width=1)
        _draw_centered_text(draw, "+", px + plus_size // 2, py - 1, load_font(13, bold=True), fill=GRAFITE)


def _draw_centered_text(draw, text, cx, cy, font, fill="#000", italic=False):
    # Pillow ImageFont nao tem italic via parametro — manter sem
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    draw.text((cx - w // 2, cy - h // 2), text, font=font, fill=fill)


def _draw_wrapped_text(draw, text, x, y, max_w, max_h, font, fill="#000"):
    # Wrap manual por palavras (curto suficiente; cada task tem 2-4 palavras)
    words = text.split(" ")
    lines: list[str] = []
    cur = ""
    for w in words:
        candidate = (cur + " " + w).strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] > max_w and cur:
            lines.append(cur)
            cur = w
        else:
            cur = candidate
    if cur:
        lines.append(cur)
    line_h = (draw.textbbox((0, 0), "Aj", font=font)[3] - draw.textbbox((0, 0), "Aj", font=font)[1]) + 4
    total_h = line_h * len(lines)
    start_y = y + max((max_h - total_h) // 2, 0)
    for i, ln in enumerate(lines):
        bbox = draw.textbbox((0, 0), ln, font=font)
        lw = bbox[2] - bbox[0]
        draw.text((x + (max_w - lw) // 2, start_y + i * line_h), ln, font=font, fill=fill)


# ============================================================
# Flows (setas)
# ============================================================

def draw_arrow(draw, start: tuple[int, int], end: tuple[int, int], dashed: bool = False, color: str = GRAFITE, width: int = FLOW_W):
    """Seta com cabeca triangular."""
    sx, sy = start
    ex, ey = end
    if dashed:
        _draw_dashed_line(draw, sx, sy, ex, ey, color=color, width=width, dash_len=8, gap_len=6)
    else:
        draw.line([(sx, sy), (ex, ey)], fill=color, width=width)
    # Cabeca da seta
    angle = math.atan2(ey - sy, ex - sx)
    head_len = 14
    head_half = 6
    hx1 = ex - head_len * math.cos(angle) + head_half * math.cos(angle + math.pi / 2)
    hy1 = ey - head_len * math.sin(angle) + head_half * math.sin(angle + math.pi / 2)
    hx2 = ex - head_len * math.cos(angle) + head_half * math.cos(angle - math.pi / 2)
    hy2 = ey - head_len * math.sin(angle) + head_half * math.sin(angle - math.pi / 2)
    draw.polygon([(ex, ey), (hx1, hy1), (hx2, hy2)], fill=color)


def draw_orthogonal_arrow(draw, start: tuple[int, int], end: tuple[int, int], dashed: bool = False, color: str = GRAFITE):
    """Seta ortogonal (90 graus). Se start e end estao em colunas diferentes, faz cotovelo."""
    sx, sy = start
    ex, ey = end
    if abs(sx - ex) < 2 or abs(sy - ey) < 2:
        # Linha reta
        draw_arrow(draw, start, end, dashed=dashed, color=color)
        return
    # Cotovelo: horizontal primeiro, depois vertical
    mid = (ex, sy)
    if dashed:
        _draw_dashed_line(draw, sx, sy, mid[0], mid[1], color=color, width=FLOW_W, dash_len=8, gap_len=6)
        _draw_dashed_line(draw, mid[0], mid[1], ex, ey, color=color, width=FLOW_W, dash_len=8, gap_len=6)
    else:
        draw.line([start, mid], fill=color, width=FLOW_W)
        draw.line([mid, end], fill=color, width=FLOW_W)
    # Cabeca
    angle = math.atan2(ey - mid[1], ex - mid[0]) if abs(ex - mid[0]) > 2 else math.atan2(ey - mid[1], 1e-3)
    head_len = 14
    head_half = 6
    hx1 = ex - head_len * math.cos(angle) + head_half * math.cos(angle + math.pi / 2)
    hy1 = ey - head_len * math.sin(angle) + head_half * math.sin(angle + math.pi / 2)
    hx2 = ex - head_len * math.cos(angle) + head_half * math.cos(angle - math.pi / 2)
    hy2 = ey - head_len * math.sin(angle) + head_half * math.sin(angle - math.pi / 2)
    draw.polygon([(ex, ey), (hx1, hy1), (hx2, hy2)], fill=color)


def _draw_dashed_line(draw, x1, y1, x2, y2, color, width=2, dash_len=8, gap_len=6):
    dx = x2 - x1
    dy = y2 - y1
    dist = math.hypot(dx, dy)
    if dist < 1:
        return
    ux = dx / dist
    uy = dy / dist
    pos = 0.0
    drawing = True
    while pos < dist:
        seg = dash_len if drawing else gap_len
        end_pos = min(pos + seg, dist)
        if drawing:
            sx = x1 + ux * pos
            sy = y1 + uy * pos
            ex = x1 + ux * end_pos
            ey = y1 + uy * end_pos
            draw.line([(sx, sy), (ex, ey)], fill=color, width=width)
        pos = end_pos
        drawing = not drawing


# ============================================================
# Lane / pool
# ============================================================

def draw_lane(draw, x: int, y: int, w: int, h: int, title: str, header_color: str):
    """Raia BPMN: retangulo grande com header vertical lateral."""
    draw.rectangle([x, y, x + w, y + h], outline=GRAFITE, fill=LANE_BG, width=LANE_BORDER_W)
    # Header lateral (cor)
    header_w = 60
    draw.rectangle([x, y, x + header_w, y + h], outline=GRAFITE, fill=header_color, width=LANE_BORDER_W)
    # Texto vertical (rotaciona)
    title_font = load_font(20, bold=True)
    txt_img = Image.new("RGBA", (h - 40, header_w), (0, 0, 0, 0))
    txt_draw = ImageDraw.Draw(txt_img)
    bbox = txt_draw.textbbox((0, 0), title, font=title_font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    txt_draw.text(((h - 40 - tw) // 2, (header_w - th) // 2 - 4), title, font=title_font, fill="#ffffff")
    rotated = txt_img.rotate(90, expand=True)
    img_main = draw._image
    img_main.paste(rotated, (x + 2, y + 20), rotated)


# ============================================================
# Definicao do fluxograma
# ============================================================

def build_diagram() -> Image.Image:
    # Layout: 3 pools verticais empilhados
    # Tamanho total estimado: 1900 x 4200
    W = 1900
    H = 4500

    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # ---------- Title ----------
    title_font = load_font(28, bold=True)
    sub_font = load_font(14, bold=False)
    draw.text((80, 30), "Lightwall Orçamento — Pipeline de Análise (BPMN)",
              font=title_font, fill=ANIL)
    draw.text((80, 70),
              "Fluxograma completo do upload até o orçamento final.  3 raias: Cliente (React), Server (Node/Express), CV-Service (Python).",
              font=sub_font, fill=MUTED)

    # ---------- Pool dimensions ----------
    LANE_X = 60
    LANE_W = W - 120
    LANE_HEADER_W = 60

    # Pool 1 — Cliente
    lane1_y = 130
    lane1_h = 200
    draw_lane(draw, LANE_X, lane1_y, LANE_W, lane1_h, "Cliente (React)", LANE_HEADER)

    # Pool 2 — Server (muito maior)
    lane2_y = lane1_y + lane1_h + 30
    lane2_h = 3400
    draw_lane(draw, LANE_X, lane2_y, LANE_W, lane2_h, "Server (Node + Express)", LANE_HEADER_ALT)

    # Pool 3 — CV-Service
    lane3_y = lane2_y + lane2_h + 30
    lane3_h = 260
    draw_lane(draw, LANE_X, lane3_y, LANE_W, lane3_h, "CV-Service (Python / FastAPI) — opcional", LANE_HEADER_CV)

    # ---------- Fonts pra nodes ----------
    f_node = load_font(13, bold=True)
    f_small = load_font(11)

    # ============================================================
    # Pool 1: Cliente
    # ============================================================
    cli_cy = lane1_y + lane1_h // 2
    cli_x = LANE_X + LANE_HEADER_W + 40

    n_start = Node("start", "Usuário inicia", x=cli_x, y=cli_cy - 30, w=60, h=60)
    n_upload = Node("task", "Cria projeto + faz upload\nPDF / IFC / imagens", x=cli_x + 110, y=cli_cy - 35, w=230, h=70, accent=CYAN)
    n_kickoff = Node("task", "POST\n/api/projects/:id/process", x=cli_x + 380, y=cli_cy - 35, w=230, h=70, accent=CYAN)
    n_sse = Node("task", "Consome SSE\n/progress + /ai-events", x=cli_x + 650, y=cli_cy - 35, w=230, h=70, accent=CYAN)
    n_ui = Node("task", "Renderiza Quantitativos\n+ orçamento + planta", x=cli_x + 920, y=cli_cy - 35, w=240, h=70, accent=CYAN)
    n_end_client = Node("end", "Documento entregável", x=cli_x + 1210, y=cli_cy - 30, w=60, h=60)

    for n in (n_start, n_upload, n_kickoff, n_sse, n_ui, n_end_client):
        draw_node(draw, n, f_node, f_small)

    draw_arrow(draw, n_start.right(), n_upload.left())
    draw_arrow(draw, n_upload.right(), n_kickoff.left())
    draw_arrow(draw, n_kickoff.right(), n_sse.left())
    draw_arrow(draw, n_sse.right(), n_ui.left())
    draw_arrow(draw, n_ui.right(), n_end_client.left())

    # ============================================================
    # Pool 2: Server — fluxo vertical principal
    # ============================================================
    # Coluna central de tasks (~x = 800)
    col_x = LANE_X + LANE_HEADER_W + 280
    col_w = 320
    task_h = 64
    spacing = 22  # entre tasks
    sec_spacing = 36  # entre secoes

    cur_y = lane2_y + 50

    def add_task(label: str, sub_label: str = "", kind: str = "task", accent: str = ANIL, extra_h: int = 0) -> Node:
        nonlocal cur_y
        h = task_h + extra_h
        n = Node(kind, label, x=col_x, y=cur_y, w=col_w, h=h, sub_label=sub_label, accent=accent)
        draw_node(draw, n, f_node, f_small)
        cur_y += h + spacing
        return n

    def section_header(text: str, color: str = ANIL):
        nonlocal cur_y
        cur_y += sec_spacing
        # Linha + label
        f_section = load_font(14, bold=True)
        draw.line([(col_x - 200, cur_y), (col_x - 30, cur_y)], fill=color, width=2)
        draw.line([(col_x + col_w + 30, cur_y), (col_x + col_w + 200, cur_y)], fill=color, width=2)
        _draw_centered_text(draw, text, col_x + col_w // 2, cur_y, f_section, fill=color)
        cur_y += sec_spacing

    # ---- Start do server ----
    n_srv_start = Node("start", "Recebe POST /process", x=col_x + col_w // 2 - 30, y=cur_y, w=60, h=60)
    draw_node(draw, n_srv_start, f_node, f_small)
    cur_y += 60 + spacing

    # Message flow do cliente pro server (tracejado)
    draw_arrow(draw, (n_kickoff.cx(), n_kickoff.y + n_kickoff.h),
               (n_srv_start.cx(), n_srv_start.y), dashed=True, color=MUTED)

    section_header("Por arquivo (loop)")

    n_05 = add_task("Etapa 0.5 — Pre-flight", "inspectFile: tipo, vetorial, DPI")
    # Gateway IFC?
    gw_y = cur_y
    gw = Node("gateway", "É IFC?", x=col_x + col_w // 2 - 35, y=gw_y, w=70, h=70, gateway_marker="X")
    draw_node(draw, gw, f_node, f_small)
    cur_y += 70 + spacing + 20  # extra pra dar espaço pro label "Não"

    # Ramo "Sim" → IFC parser à direita
    ifc_x = col_x + col_w + 120
    n_ifc = Node("task", "Etapa 1 — Leitura IFC", x=ifc_x, y=gw.y, w=240, h=70, sub_label="parser BIM, sem IA", accent=PURPLE)
    draw_node(draw, n_ifc, f_node, f_small)
    # Setas para IFC
    draw.line([gw.right(), (ifc_x, gw.cy())], fill=GRAFITE, width=FLOW_W)
    draw_arrow(draw, (ifc_x - 1, gw.cy()), (ifc_x, gw.cy()))
    # Label "Sim"
    _draw_centered_text(draw, "Sim", (gw.x + gw.w + ifc_x) // 2, gw.cy() - 12, f_small, fill=GREEN)
    # Label "Não" no caminho que continua descendo
    _draw_centered_text(draw, "Não", gw.cx() + 18, gw.y + gw.h + 8, f_small, fill=RED)

    # Continuacao do ramo "Nao" — Classificacao
    n_1 = add_task("Etapa 1 — Classificação + Tabelas", "Gemini ou OpenAI (per página)")
    n_25 = add_task("Etapa 2.5 — Extração vetorial nativa", "pdf-lib lê edges/bbox direto")
    n_3 = add_task("Etapa 3 — Extração geométrica", "walls / slabs / corners por planta")

    # IFC bypass: do n_ifc desce e une depois da Etapa 3 (na Fusão)
    # Vou desenhar essa linha mais tarde quando souber a y da fusao.

    section_header("Global (após loop)", color=CYAN)

    n_15 = add_task("Etapa 1.5 — Caracterização", "JSON estruturado: typology, padrão, ranges", accent=CYAN, extra_h=10)
    n_34 = add_task("Etapa 3.4 — CV Pipeline (Fase E)", "cv-service stream — sub-passos", kind="subproc", accent=PURPLE, extra_h=10)
    n_35 = add_task("Etapa 3.5 — Inventário (endpoints)", "wallInventory: p1, p2, thickness")
    n_36 = add_task("Etapa 3.6 — Cotas focadas", "leitura de cotas + merge")
    n_37 = add_task("Etapa 3.7 — Topologia", "envelope + classificação determinística")
    n_38 = add_task("Etapa 3.8 — Lajes (polygon)", "shoelace via envelope")
    n_4 = add_task("Etapa 4 — Fusão multivista", "dedup + procedência multi-vista", accent=ANIL, extra_h=10)

    # Liga IFC bypass: do n_ifc.bottom desce e entra em n_4.right
    # Linha vertical + horizontal
    bypass_x = n_ifc.cx()
    draw.line([(bypass_x, n_ifc.y + n_ifc.h), (bypass_x, n_4.cy())], fill=GRAFITE, width=FLOW_W)
    draw_arrow(draw, (bypass_x, n_4.cy()), (n_4.x + n_4.w, n_4.cy()))

    section_header("Validações", color=ORANGE)

    n_45 = add_task("Etapa 4.5 — Validação geométrica", "descarta áreas absurdas")
    n_455 = add_task("Etapa 4.55 — Esquadrias (linker)", "cruza com quadro de esquadrias")
    n_46 = add_task("Etapa 4.6 — Validação global IA", "Gemini cross-checking")
    n_465 = add_task("Etapa 4.65 — Reconciliação CV-LLM", "A/B paredes CV vs LLM")
    n_47 = add_task("Etapa 4.7 — Validação por cortes", "reconcilia altura_m")
    n_49 = add_task("Etapa 4.9 — SelfCheck", "9 checks determinísticos → audit_notes", accent=ORANGE, extra_h=10)

    section_header("Cálculo + orçamento", color=ANIL)

    n_5 = add_task("Etapa 5 — Cálculo de quantitativos", "painéis por pavimento (Manual Biomassa)")
    n_6 = add_task("Etapa 6 — Integração com catálogo", "preços + frete + descontos")
    n_7 = add_task("Etapa 7 — Validação de inconsistências", "inconsistencias[] por severidade")

    # Parallel gateway antes de 7.5 + 8
    cur_y += sec_spacing
    gw2 = Node("gateway", "Em paralelo", x=col_x + col_w // 2 - 35, y=cur_y, w=70, h=70, gateway_marker="+")
    draw_node(draw, gw2, f_node, f_small)
    cur_y += 70 + 60

    # n_75 e n_8 lado a lado
    n_75 = Node("task", "Etapa 7.5 — Imagem anotada",
                x=col_x - 200, y=cur_y, w=290, h=74,
                sub_label="renderer SVG: paredes pintadas", accent=RED)
    n_8 = Node("task", "Etapa 8 — Descrição do projeto",
               x=col_x + col_w - 90, y=cur_y, w=290, h=74,
               sub_label="markdown, usa caracterização", accent=GREEN)
    draw_node(draw, n_75, f_node, f_small)
    draw_node(draw, n_8, f_node, f_small)
    cur_y += 74 + 60

    # Join gateway
    gw3 = Node("gateway", "Junta", x=col_x + col_w // 2 - 35, y=cur_y, w=70, h=70, gateway_marker="+")
    draw_node(draw, gw3, f_node, f_small)
    cur_y += 70 + spacing

    # End event server
    n_srv_end = Node("end", "status=completed", x=col_x + col_w // 2 - 30, y=cur_y, w=60, h=60)
    draw_node(draw, n_srv_end, f_node, f_small)

    # ---- Setas server: sequência principal ----
    # 0.5 → gw
    draw_arrow(draw, n_05.bottom(), gw.top())
    # gw.bottom → n_1.top (ramo Nao)
    draw_arrow(draw, gw.bottom(), n_1.top())
    # n_1 → n_25 → n_3
    draw_arrow(draw, n_1.bottom(), n_25.top())
    draw_arrow(draw, n_25.bottom(), n_3.top())
    # n_3 → n_15 (continua na coluna principal)
    draw_arrow(draw, n_3.bottom(), n_15.top())
    # n_15 → 34 → 35 → 36 → 37 → 38 → 4
    draw_arrow(draw, n_15.bottom(), n_34.top())
    draw_arrow(draw, n_34.bottom(), n_35.top())
    draw_arrow(draw, n_35.bottom(), n_36.top())
    draw_arrow(draw, n_36.bottom(), n_37.top())
    draw_arrow(draw, n_37.bottom(), n_38.top())
    draw_arrow(draw, n_38.bottom(), n_4.top())
    # 4 → 4.5 → 4.55 → 4.6 → 4.65 → 4.7 → 4.9
    draw_arrow(draw, n_4.bottom(), n_45.top())
    draw_arrow(draw, n_45.bottom(), n_455.top())
    draw_arrow(draw, n_455.bottom(), n_46.top())
    draw_arrow(draw, n_46.bottom(), n_465.top())
    draw_arrow(draw, n_465.bottom(), n_47.top())
    draw_arrow(draw, n_47.bottom(), n_49.top())
    # 4.9 → 5 → 6 → 7
    draw_arrow(draw, n_49.bottom(), n_5.top())
    draw_arrow(draw, n_5.bottom(), n_6.top())
    draw_arrow(draw, n_6.bottom(), n_7.top())
    # 7 → gw2(+)
    draw_arrow(draw, n_7.bottom(), gw2.top())
    # gw2 → n_75 + n_8 (fork)
    draw.line([(gw2.cx() - 35, gw2.cy()), (n_75.cx(), gw2.cy())], fill=GRAFITE, width=FLOW_W)
    draw.line([(gw2.cx() + 35, gw2.cy()), (n_8.cx(), gw2.cy())], fill=GRAFITE, width=FLOW_W)
    draw_arrow(draw, (n_75.cx(), gw2.cy()), (n_75.cx(), n_75.y))
    draw_arrow(draw, (n_8.cx(), gw2.cy()), (n_8.cx(), n_8.y))
    # n_75 + n_8 → gw3 (join)
    draw.line([(n_75.cx(), n_75.y + n_75.h), (n_75.cx(), gw3.cy())], fill=GRAFITE, width=FLOW_W)
    draw.line([(n_8.cx(), n_8.y + n_8.h), (n_8.cx(), gw3.cy())], fill=GRAFITE, width=FLOW_W)
    draw.line([(n_75.cx(), gw3.cy()), (gw3.cx() - 35, gw3.cy())], fill=GRAFITE, width=FLOW_W)
    draw_arrow(draw, (gw3.cx() + 35, gw3.cy()), (n_8.cx(), gw3.cy()))
    draw_arrow(draw, (n_75.cx(), gw3.cy()), (gw3.cx() - 35, gw3.cy()))
    # gw3 → n_srv_end
    draw_arrow(draw, gw3.bottom(), n_srv_end.top())

    # n_srv_start → n_05
    draw_arrow(draw, n_srv_start.bottom(), n_05.top())

    # Message flow de volta do server para o cliente (SSE)
    draw_arrow(draw, (n_srv_end.x + n_srv_end.w, n_srv_end.cy()),
               (n_sse.cx() - 100, n_sse.y + n_sse.h + 5), dashed=True, color=MUTED)

    # ============================================================
    # Pool 3: CV-Service
    # ============================================================
    cv_cy = lane3_y + lane3_h // 2
    cv_x = LANE_X + LANE_HEADER_W + 40
    cv_h = 70

    cvs = Node("start", "POST /full_extraction/stream", x=cv_x, y=cv_cy - 30, w=60, h=60)
    cv_pre = Node("task", "preprocess", x=cv_x + 130, y=cv_cy - 35, w=160, h=cv_h, sub_label="binarize, denoise", accent=PURPLE)
    cv_env = Node("task", "envelope", x=cv_x + 320, y=cv_cy - 35, w=160, h=cv_h, sub_label="alphashape multi-scale", accent=PURPLE)
    cv_ocr = Node("task", "OCR semântico", x=cv_x + 510, y=cv_cy - 35, w=180, h=cv_h, sub_label="EasyOCR + dict pt-BR", accent=PURPLE)
    cv_wall = Node("task", "wall_detect", x=cv_x + 720, y=cv_cy - 35, w=160, h=cv_h, sub_label="skeletonize + Harris", accent=PURPLE)
    cv_cls = Node("task", "classify topology", x=cv_x + 910, y=cv_cy - 35, w=200, h=cv_h, sub_label="Shapely point-in-polygon", accent=PURPLE)
    cv_end = Node("end", "retorna walls + envelope", x=cv_x + 1140, y=cv_cy - 30, w=60, h=60)

    for n in (cvs, cv_pre, cv_env, cv_ocr, cv_wall, cv_cls, cv_end):
        draw_node(draw, n, f_node, f_small)

    draw_arrow(draw, cvs.right(), cv_pre.left())
    draw_arrow(draw, cv_pre.right(), cv_env.left())
    draw_arrow(draw, cv_env.right(), cv_ocr.left())
    draw_arrow(draw, cv_ocr.right(), cv_wall.left())
    draw_arrow(draw, cv_wall.right(), cv_cls.left())
    draw_arrow(draw, cv_cls.right(), cv_end.left())

    # Message flow: n_34 (Etapa 3.4) <-> cv-service stream
    draw_arrow(draw, (n_34.x + n_34.w, n_34.cy()), (lane3_y + 0, cvs.cy()), dashed=True, color=PURPLE)
    draw_arrow(draw, (cv_end.x + cv_end.w + 20, cv_end.cy()), (n_34.x + n_34.w + 60, n_34.cy() + 20), dashed=True, color=PURPLE)

    # ============================================================
    # Legenda
    # ============================================================
    leg_y = H - 110
    leg_x = LANE_X
    f_leg = load_font(13, bold=True)
    f_leg_small = load_font(11)
    draw.rectangle([leg_x, leg_y, LANE_X + LANE_W, leg_y + 90], outline=GRAFITE, fill="#fafbfc", width=1)
    draw.text((leg_x + 20, leg_y + 8), "Legenda BPMN", font=f_leg, fill=ANIL)

    # Items
    items = [
        ("○", GREEN, "Start event (início)"),
        ("◉", GRAFITE, "End event (conclusão)"),
        ("▭", CYAN, "Task (atividade)"),
        ("▭₊", PURPLE, "Sub-process (expandido em outra raia)"),
        ("◇", ORANGE, "Gateway X = exclusivo, + = paralelo"),
        ("→", GRAFITE, "Sequence flow"),
        ("⇢", MUTED, "Message flow (entre raias)"),
    ]
    ix = leg_x + 20
    iy = leg_y + 40
    for symbol, color, text in items:
        f_symbol = load_font(18, bold=True)
        draw.text((ix, iy - 2), symbol, font=f_symbol, fill=color)
        draw.text((ix + 28, iy + 4), text, font=f_leg_small, fill=GRAFITE)
        ix += 260

    return img


# ============================================================
# Entrypoint
# ============================================================

def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    out = repo_root / "docs" / "PIPELINE_BPMN.png"
    img = build_diagram()
    img.save(out, format="PNG", optimize=True)
    print(f"OK: {out} ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
