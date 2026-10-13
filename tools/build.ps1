# =============================================================================
#  build.ps1 — Empaqueta el plugin como .rbz instalable en SketchUp
# -----------------------------------------------------------------------------
#  Un .rbz es un .zip renombrado. En su raíz deben quedar:
#     royal_kitchens_studio.rb        (el registrar que SketchUp descubre)
#     royal_kitchens_studio/...       (main.rb, dialogo.rb, puente.rb, proyecto.rb, ui/)
#  Studio no incluye a los otros dos plugins: se instalan aparte.
#
#  Uso (desde la consola de PowerShell, en cualquier carpeta):
#     powershell -ExecutionPolicy Bypass -File "<repo>\tools\build.ps1"
#
#  Salida: dist\royal_kitchens_studio.rbz
# =============================================================================

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression            # ZipArchive / ZipArchiveMode
Add-Type -AssemblyName System.IO.Compression.FileSystem # ZipFile / ZipFileExtensions

$repoRoot  = Split-Path $PSScriptRoot -Parent
$pluginDir = Join-Path $repoRoot 'src'
$distDir   = Join-Path $repoRoot 'dist'
$rbz       = Join-Path $distDir 'royal_kitchens_studio.rbz'

# Área de armado limpia: se copia solo lo que va dentro del paquete.
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("rks_build_" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    Copy-Item (Join-Path $pluginDir 'royal_kitchens_studio.rb') $staging
    Copy-Item (Join-Path $pluginDir 'royal_kitchens_studio')    $staging -Recurse
    # componentes/anterior guarda la versión previa de cada componente base: no se empaqueta.
    Remove-Item (Join-Path $staging 'royal_kitchens_studio\componentes\anterior') -Recurse -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
    if (Test-Path $rbz) { Remove-Item $rbz -Force }

    # Las entradas se escriben a mano para forzar "/" como separador: tanto
    # Compress-Archive de PowerShell 5.1 como ZipFile::CreateFromDirectory sobre
    # .NET Framework usan "\", y el instalador de SketchUp espera "/".
    $zip = [System.IO.Compression.ZipFile]::Open($rbz, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $raiz = (Resolve-Path $staging).Path.TrimEnd('\') + '\'
        Get-ChildItem $staging -Recurse -File | Sort-Object FullName | ForEach-Object {
            $rel = $_.FullName.Substring($raiz.Length).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally {
        $zip.Dispose()
    }

    # Verificación: listar lo empaquetado.
    $check = [System.IO.Compression.ZipFile]::OpenRead($rbz)
    try {
        Write-Host "`nEmpaquetado en: $rbz" -ForegroundColor Green
        Write-Host ("{0} archivos, {1:N0} KB" -f $check.Entries.Count, ((Get-Item $rbz).Length / 1KB))
        $check.Entries | Sort-Object FullName | ForEach-Object { Write-Host ("  " + $_.FullName) }
        if ($check.Entries.FullName -match '\\') {
            throw "El paquete quedó con '\' en las rutas; SketchUp espera '/'."
        }
    } finally {
        $check.Dispose()
    }
} finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
