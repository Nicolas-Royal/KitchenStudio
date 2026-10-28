# =============================================================================
#  texturas.ps1 — Deja listas para SketchUp las texturas generadas (Gemini)
# -----------------------------------------------------------------------------
#  Cada imagen de la carpeta de entrada se llama como el id del material
#  (ENCINO_AVELLANA.webp, MDF_OAK_SANREMO.png...). Para cada una:
#     1. Quita la franja oscura que suelen traer las orillas (-Orilla px) y
#        la deja de -Lado x -Lado.
#     2. La vuelve repetible: funde cada orilla con la imagen desplazada media
#        vuelta, un eje a la vez (-Banda = ancho de la transición, fracción
#        del lado).
#     3. Ajusta el color: el promedio por canal queda igual al de su muestra
#        de la Guía RK (src/.../catalogo/materiales/<id>.jpg); la veta se
#        conserva (ganancia por canal, no se aplana el contraste).
#  Salida en -Salida: <id>.png (la textura) y prueba/<id>_3x3.jpg (mosaico
#  para revisarla a ojo), más un reporte de color y costura por material.
#  Costura = diferencia en la unión / diferencia normal entre vecinos: ~1x no
#  se nota.
#
#  Uso:
#     powershell -ExecutionPolicy Bypass -File tools\texturas.ps1 -Entrada <carpeta>
#        [-Salida <carpeta>] [-Orilla 24] [-Banda 0.22] [-Lado 1024]
# =============================================================================
param(
    [Parameter(Mandatory = $true)][string]$Entrada,
    [string]$Salida,
    [int]$Orilla = 24,
    [double]$Banda = 0.22,
    [int]$Lado = 1024
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, WindowsBase, System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class RKTextura {
  public static byte[] Leer(Bitmap b) {
    var d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    var px = new byte[b.Width * b.Height * 3];
    for (int y = 0; y < b.Height; y++) Marshal.Copy(d.Scan0 + y * d.Stride, px, y * b.Width * 3, b.Width * 3);
    b.UnlockBits(d); return px;
  }
  public static Bitmap Escribir(byte[] px, int w, int h) {
    var b = new Bitmap(w, h, PixelFormat.Format24bppRgb);
    var d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
    for (int y = 0; y < h; y++) Marshal.Copy(px, y * w * 3, d.Scan0 + y * d.Stride, w * 3);
    b.UnlockBits(d); return b;
  }
  // Promedio por canal (BGR).
  public static double[] Media(byte[] px) {
    var s = new double[3]; int n = px.Length / 3;
    for (int i = 0; i < px.Length; i++) s[i % 3] += px[i];
    return new double[] { s[0] / n, s[1] / n, s[2] / n };
  }
  public static void Ganancia(byte[] px, double[] g) {
    for (int i = 0; i < px.Length; i++) px[i] = (byte)Math.Max(0, Math.Min(255, Math.Round(px[i] * g[i % 3])));
  }
  // Un eje: S = la imagen desplazada media vuelta (sus orillas continúan; su
  // costura queda al centro). Orillas de S, centro de la original. Un eje a
  // la vez para no usar S sobre su propia costura.
  public static byte[] Eje(byte[] a, int w, int h, double banda, bool enX) {
    var o = new byte[a.Length];
    int n = enX ? w : h; double b = n * banda;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      int p = enX ? x : y;
      double t = Math.Min(1, Math.Min(p, n - 1 - p) / b); t = t * t * (3 - 2 * t);
      int xs = enX ? (x + w / 2) % w : x, ys = enX ? y : (y + h / 2) % h;
      int i = (y * w + x) * 3, j = (ys * w + xs) * 3;
      for (int c = 0; c < 3; c++) o[i + c] = (byte)Math.Round(a[i + c] * t + a[j + c] * (1 - t));
    }
    return o;
  }
  // Diferencia media por pixel entre la columna (o fila) p y q.
  static double Dif(byte[] a, int w, int h, int p, int q, bool col) {
    double t = 0; int n = col ? h : w;
    for (int k = 0; k < n; k++) {
      int i = col ? (k * w + p) * 3 : (p * w + k) * 3, j = col ? (k * w + q) * 3 : (q * w + k) * 3;
      for (int c = 0; c < 3; c++) t += Math.Abs(a[i + c] - a[j + c]);
    }
    return t / (n * 3);
  }
  // Costura al repetir: unión de las orillas / promedio entre vecinos del interior.
  public static double Costura(byte[] a, int w, int h, bool col) {
    int n = col ? w : h; double normal = 0;
    for (int k = 1; k <= 5; k++) { int p = n * k / 6; normal += Dif(a, w, h, p, p + 1, col); }
    return Dif(a, w, h, n - 1, 0, col) / Math.Max(0.01, normal / 5);
  }
}
"@

$repoRoot   = Split-Path $PSScriptRoot -Parent
$muestras   = Join-Path $repoRoot 'src\royal_kitchens_studio\catalogo\materiales'
if (-not $Salida) { $Salida = Join-Path $Entrada 'listas' }
$prueba = Join-Path $Salida 'prueba'
New-Item -ItemType Directory -Force -Path $prueba | Out-Null

# Cualquier formato que lea Windows (WebP incluido) a Bitmap de 24 bits.
function Abrir([string]$ruta) {
    $dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create((New-Object Uri $ruta), 'None', 'OnLoad')
    $enc = New-Object System.Windows.Media.Imaging.BmpBitmapEncoder
    $enc.Frames.Add($dec.Frames[0])
    $ms = New-Object System.IO.MemoryStream
    $enc.Save($ms); $ms.Position = 0
    $b = [System.Drawing.Bitmap]::FromStream($ms)
    $b24 = $b.Clone((New-Object System.Drawing.Rectangle 0, 0, $b.Width, $b.Height), [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $b.Dispose()
    $b24
}
function Hex($m) { '#{0:x2}{1:x2}{2:x2}' -f [int]$m[2], [int]$m[1], [int]$m[0] }

$reporte = @()
$archivos = Get-ChildItem -Path $Entrada -File | Where-Object { $_.Extension -match '^\.(webp|png|jpe?g|bmp|tiff?)$' }
foreach ($f in $archivos) {
    $id = $f.BaseName.ToUpper()
    $ref = Join-Path $muestras "$id.jpg"
    if (-not (Test-Path $ref)) { Write-Warning "$($f.Name): no hay muestra $id.jpg en catalogo/materiales (el archivo debe llamarse como el id)"; continue }

    $g0 = Abrir $f.FullName
    $r  = Abrir $ref
    $antes = [RKTextura]::Leer($g0)
    $costuraAntes = @([RKTextura]::Costura($antes, $g0.Width, $g0.Height, $true), [RKTextura]::Costura($antes, $g0.Width, $g0.Height, $false))

    # 1. Sin la franja de las orillas, a -Lado.
    $g = New-Object System.Drawing.Bitmap $Lado, $Lado, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $gr = [System.Drawing.Graphics]::FromImage($g)
    $gr.InterpolationMode = 'HighQualityBicubic'; $gr.PixelOffsetMode = 'HighQuality'
    $gr.DrawImage($g0, (New-Object System.Drawing.Rectangle 0, 0, $Lado, $Lado),
        (New-Object System.Drawing.Rectangle $Orilla, $Orilla, ($g0.Width - 2 * $Orilla), ($g0.Height - 2 * $Orilla)), 'Pixel')
    $gr.Dispose()
    $px = [RKTextura]::Leer($g)

    # 2. Repetible (antes del color: así el promedio final es el de la guía).
    $px = [RKTextura]::Eje([RKTextura]::Eje($px, $Lado, $Lado, $Banda, $true), $Lado, $Lado, $Banda, $false)

    # 3. Color de la Guía RK.
    $mr = [RKTextura]::Media([RKTextura]::Leer($r))
    $mg = [RKTextura]::Media($px)
    [RKTextura]::Ganancia($px, @(($mr[0] / $mg[0]), ($mr[1] / $mg[1]), ($mr[2] / $mg[2])))
    $out = [RKTextura]::Escribir($px, $Lado, $Lado)
    $out.Save((Join-Path $Salida "$id.png"), [System.Drawing.Imaging.ImageFormat]::Png)

    # Prueba: mosaico 3x3.
    $t = 400
    $m = New-Object System.Drawing.Bitmap ($t * 3), ($t * 3)
    $gr = [System.Drawing.Graphics]::FromImage($m); $gr.InterpolationMode = 'HighQualityBicubic'
    for ($i = 0; $i -lt 3; $i++) { for ($j = 0; $j -lt 3; $j++) { $gr.DrawImage($out, $i * $t, $j * $t, $t, $t) } }
    $gr.Dispose()
    $m.Save((Join-Path $prueba "${id}_3x3.jpg"), [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $m.Dispose()

    $reporte += [pscustomobject]@{
        Material      = $id
        Guia          = Hex $mr
        Gemini        = Hex ([RKTextura]::Media($antes))
        Final         = Hex ([RKTextura]::Media($px))
        'Costura antes' = '{0:N1}x / {1:N1}x' -f $costuraAntes[0], $costuraAntes[1]
        'Costura final' = '{0:N1}x / {1:N1}x' -f [RKTextura]::Costura($px, $Lado, $Lado, $true), [RKTextura]::Costura($px, $Lado, $Lado, $false)
    }
    $out.Dispose(); $g.Dispose(); $g0.Dispose(); $r.Dispose()
}

if (-not $reporte) { Write-Warning "No se proceso ninguna imagen en $Entrada"; return }
$reporte | Format-Table -AutoSize | Out-String -Width 200
"Costura = izquierda-derecha / arriba-abajo (~1x no se nota)."
"Texturas en $Salida; mosaicos de prueba en $prueba"
