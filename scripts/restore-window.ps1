# restore-window.ps1 <HWND>
# Restores and brings a window to foreground by its native window handle.

param([Parameter(Mandatory=$true)][long]$HWnd)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinRestore {
    const int SW_RESTORE = 9;
    const int SW_SHOW    = 5;

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    public static void RestoreAndFocus(long hwnd) {
        IntPtr hWnd = new IntPtr(hwnd);
        if (IsIconic(hWnd)) {
            ShowWindow(hWnd, SW_RESTORE);
        } else {
            ShowWindow(hWnd, SW_SHOW);
        }
        BringWindowToTop(hWnd);
        SetForegroundWindow(hWnd);
    }
}
"@ -ErrorAction Stop

[WinRestore]::RestoreAndFocus($HWnd)
