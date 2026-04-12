# get-icon.ps1 <PID>
# Extracts the associated icon from the process executable and outputs it as base64-encoded PNG.

param([Parameter(Mandatory=$true)][int]$ProcessId)

Add-Type -AssemblyName System.Drawing -ErrorAction Stop

try {
    $proc = Get-Process -Id $ProcessId -ErrorAction Stop
    $exePath = $proc.MainModule.FileName

    if (-not $exePath -or -not (Test-Path $exePath)) { exit 1 }

    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
    if (-not $icon) { exit 1 }

    # Resize to 32x32 for compact taskbar display
    $srcBmp = $icon.ToBitmap()
    $dstBmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($dstBmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($srcBmp, 0, 0, 32, 32)
    $g.Dispose()
    $srcBmp.Dispose()
    $icon.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $dstBmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $dstBmp.Dispose()

    $bytes = $ms.ToArray()
    $ms.Dispose()

    [Console]::WriteLine([Convert]::ToBase64String($bytes))
    [Console]::Out.Flush()
} catch {
    # Fail silently — caller handles missing icons
    exit 1
}
