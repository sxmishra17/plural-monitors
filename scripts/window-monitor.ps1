# window-monitor.ps1
# Long-running script that continuously enumerates visible top-level windows
# and outputs one JSON line per second to stdout.
# The Electron main process reads this stream.

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WinEnum {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern long GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    const int GWL_EXSTYLE = -20;
    const long WS_EX_TOOLWINDOW = 0x00000080L;

    public static List<WindowData> GetAllWindows() {
        var result = new List<WindowData>();
        EnumWindows((hWnd, lParam) => {
            // Must be visible
            if (!IsWindowVisible(hWnd)) return true;

            // Must have a title
            int titleLen = GetWindowTextLength(hWnd);
            if (titleLen == 0) return true;
            var sb = new StringBuilder(titleLen + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString().Trim();
            if (string.IsNullOrEmpty(title)) return true;

            // Skip tool windows (system trays, tooltips, etc.)
            long exStyle = GetWindowLongPtr(hWnd, GWL_EXSTYLE);
            if ((exStyle & WS_EX_TOOLWINDOW) != 0) return true;

            // Skip DWM-cloaked windows (UWP background apps)
            int cloaked = 0;
            DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int));
            if (cloaked != 0) return true;

            // Skip our own taskbar windows by title prefix
            if (title.StartsWith("Plural Monitors")) return true;

            // Get rect and PID
            RECT rect;
            GetWindowRect(hWnd, out rect);
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);

            bool minimized = IsIconic(hWnd);

            result.Add(new WindowData {
                Handle = hWnd.ToInt64(),
                Title = title,
                Left = rect.Left,
                Top = rect.Top,
                Right = rect.Right,
                Bottom = rect.Bottom,
                Pid = (int)pid,
                IsMinimized = minimized
            });
            return true;
        }, IntPtr.Zero);
        return result;
    }
}

public class WindowData {
    public long Handle;
    public string Title;
    public int Left, Top, Right, Bottom;
    public int Pid;
    public bool IsMinimized;
}
"@ -ErrorAction Stop

# --- Main loop ---
# Escape JSON strings safely
function EscapeJson($s) {
    $s = $s -replace '\\', '\\\\'
    $s = $s -replace '"', '\"'
    $s = $s -replace "`r", '\r'
    $s = $s -replace "`n", '\n'
    $s = $s -replace "`t", '\t'
    return $s
}

while ($true) {
    try {
        $windows = [WinEnum]::GetAllWindows()

        $parts = @()
        foreach ($w in $windows) {
            $title = EscapeJson $w.Title
            $parts += "{""Handle"":$($w.Handle),""Title"":""$title"",""Left"":$($w.Left),""Top"":$($w.Top),""Right"":$($w.Right),""Bottom"":$($w.Bottom),""Pid"":$($w.Pid),""IsMinimized"":$(if($w.IsMinimized){'true'}else{'false'})}"
        }

        $json = "[" + ($parts -join ",") + "]"
        [Console]::WriteLine($json)
        [Console]::Out.Flush()
    } catch {
        # Output an empty array on error rather than crashing
        [Console]::WriteLine("[]")
        [Console]::Out.Flush()
    }

    Start-Sleep -Milliseconds 900
}
