$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
trap { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class FileyDesktop {
  public delegate bool EnumProc(IntPtr window, IntPtr param);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Union data; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct GuiThreadInfo {
    public uint Size, Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public Rect CaretRect;
  }
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent, IntPtr child);
  public static void CheckKeyboardFocus() {
    if (GetAncestor(Target, 2) == Target) return;
    var info = new GuiThreadInfo { Size = (uint)Marshal.SizeOf(typeof(GuiThreadInfo)) };
    if (!GetGUIThreadInfo(0, ref info) || (info.Focus != Target && !IsChild(Target, info.Focus)))
      throw new Exception("Click inside the browser before typing. Keyboard focus is outside this tab.");
  }
  public static IntPtr Target;
  public static Rect Bounds;
  public static uint ProcessId;
  public static string Title(IntPtr window) { var text = new StringBuilder(512); GetWindowText(window, text, text.Capacity); return text.ToString(); }
  public static string ClassName(IntPtr window) { var text = new StringBuilder(256); GetClassName(window, text, text.Capacity); return text.ToString(); }
  public static void CheckStop() { if ((GetAsyncKeyState(27) & 0x8000) != 0) throw new Exception("Computer action stopped by Escape."); }
  static void Send(Input[] values) {
    CheckStop();
    Rect rect; uint process;
    GetWindowThreadProcessId(Target, out process);
    if (GetForegroundWindow() != GetAncestor(Target, 2) || !IsWindowVisible(Target) || process != ProcessId || !GetWindowRect(Target, out rect)
      || rect.Left != Bounds.Left || rect.Top != Bounds.Top || rect.Right != Bounds.Right || rect.Bottom != Bounds.Bottom)
      throw new Exception("The target window changed. Take another screenshot before acting.");
    foreach (var input in values) { if (input.type == 1) { CheckKeyboardFocus(); break; } }
    if (SendInput((uint)values.Length, values, Marshal.SizeOf(typeof(Input))) != values.Length)
      throw new Exception("Windows blocked input. Elevated or protected windows cannot be controlled.");
  }
  static Input Key(ushort code, uint flags) { return new Input { type=1, data=new Union { keyboard=new Keyboard { key=code, flags=flags | ((code >= 33 && code <= 40 || code == 46) ? 1u : 0u) } } }; }
  public static void Type(string text) {
    foreach (char c in text) {
      // A line break must not press bare Enter and send a chat prematurely.
      if (c == '\n') { Send(new[] { Key(16,0), Key(13,0), Key(13,2), Key(16,2) }); continue; }
      Send(new[] { new Input { type=1, data=new Union { keyboard=new Keyboard { scan=c, flags=4 } } },
        new Input { type=1, data=new Union { keyboard=new Keyboard { scan=c, flags=6 } } } });
    }
  }
  public static void Press(ushort key, bool control) {
    Send(control ? new[] { Key(17,0), Key(key,0), Key(key,2), Key(17,2) } : new[] { Key(key,0), Key(key,2) });
  }
  public static void Click(bool right, bool twice) {
    uint down=right ? 8u : 2u, up=right ? 16u : 4u;
    var pair=new[] { new Input { data=new Union { mouse=new Mouse { flags=down } } }, new Input { data=new Union { mouse=new Mouse { flags=up } } } };
    Send(pair); if (twice) Send(pair);
  }
  public static void Scroll(int delta) { Send(new[] { new Input { data=new Union { mouse=new Mouse { flags=2048, data=unchecked((uint)(delta*120)) } } } }); }
  public static long[] Windows() {
    var result=new List<long>();
    EnumWindows((window,param) => { if (IsWindowVisible(window) && Title(window).Length > 0) result.Add(window.ToInt64()); return result.Count < 100; }, IntPtr.Zero);
    return result.ToArray();
  }
}
'@
[void][FileyDesktop]::SetProcessDPIAware()
[FileyDesktop]::CheckStop()

if ($request.action -eq 'list_windows') {
  $candidates = @([FileyDesktop]::Windows()) + @($request.browser_windows | ForEach-Object { [long]$_ })
  $windows = @($candidates | Select-Object -Unique | ForEach-Object {
    $handle = [IntPtr]::new($_)
    [uint32]$processId = 0
    [void][FileyDesktop]::GetWindowThreadProcessId($handle, [ref]$processId)
    $rootOwner = [FileyDesktop]::GetAncestor($handle, 3).ToInt64().ToString()
    $windowClass = [FileyDesktop]::ClassName($handle)
    $dialogOwner = if ($request.dialog_owner_id) { $request.dialog_owner_id } else { $request.root_window_id }
    if ([FileyDesktop]::IsWindowVisible($handle) -and (-not $request.root_window_id -or $_.ToString() -eq $request.root_window_id -or ($rootOwner -eq $dialogOwner -and $windowClass -eq '#32770'))) {
      @{ window_id = $_.ToString(); title = [FileyDesktop]::Title($handle); process_id = $processId; minimized = [FileyDesktop]::IsIconic($handle); root_owner_id = $rootOwner; window_class = $windowClass }
    }
  })
  @{ windows = $windows } | ConvertTo-Json -Depth 5 -Compress
  exit
}

$window = [IntPtr]::new([long]$request.window_id)
if (-not [FileyDesktop]::IsWindowVisible($window)) { throw 'The selected window is no longer available. List windows again.' }
[uint32]$processId = 0
[void][FileyDesktop]::GetWindowThreadProcessId($window, [ref]$processId)
if ($processId -ne $request.process_id) { throw 'The selected window was replaced. List windows again.' }
if ($request.action -eq 'screenshot') {
  if ([FileyDesktop]::IsIconic($window)) { [void][FileyDesktop]::ShowWindow($window, 9) }
} else {
  $before = [FileyDesktop+Rect]::new()
  $expected = $request.bounds
  if ([FileyDesktop]::IsIconic($window) -or -not [FileyDesktop]::GetWindowRect($window, [ref]$before) -or $before.Left -ne $expected.x -or $before.Top -ne $expected.y -or ($before.Right - $before.Left) -ne $expected.width -or ($before.Bottom - $before.Top) -ne $expected.height) { throw 'The window moved or resized. Take a new screenshot before acting.' }
}
$foreground = [FileyDesktop]::GetAncestor($window, 2)
[void][FileyDesktop]::SetForegroundWindow($foreground)
Start-Sleep -Milliseconds 180
[FileyDesktop]::CheckStop()
if ([FileyDesktop]::GetForegroundWindow() -ne $foreground) { throw 'The selected window is not in front. Bring it to the foreground and take another screenshot.' }
$rect = [FileyDesktop+Rect]::new()
if (-not [FileyDesktop]::GetWindowRect($window, [ref]$rect)) { throw 'Could not locate the selected window.' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0 -or ([long]$width * $height) -gt 16000000) { throw 'Window size is unsupported. Resize it and take another screenshot.' }

if ($request.action -eq 'screenshot') {
  $desktop = [Windows.Forms.SystemInformation]::VirtualScreen
  # Maximized windows include an invisible border outside the display. Capture
  # only visible pixels while retaining full window bounds for the input guard.
  $captureX = [Math]::Max($rect.Left, $desktop.Left)
  $captureY = [Math]::Max($rect.Top, $desktop.Top)
  $captureWidth = [Math]::Min($rect.Right, $desktop.Right) - $captureX
  $captureHeight = [Math]::Min($rect.Bottom, $desktop.Bottom) - $captureY
  if ($captureWidth -le 0 -or $captureHeight -le 0) { throw 'Move the window onto the display before capturing it.' }
  $bitmap = [Drawing.Bitmap]::new($captureWidth, $captureHeight)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $scaled = $null
  $scaledGraphics = $null
  $stream = [IO.MemoryStream]::new()
  try {
    $graphics.CopyFromScreen($captureX, $captureY, 0, 0, [Drawing.Size]::new($captureWidth, $captureHeight))
    $scale = [Math]::Min(1.0, 1600.0 / [Math]::Max($captureWidth, $captureHeight))
    $imageWidth = [Math]::Max(1, [int][Math]::Floor($captureWidth * $scale))
    $imageHeight = [Math]::Max(1, [int][Math]::Floor($captureHeight * $scale))
    $scaled = [Drawing.Bitmap]::new($imageWidth, $imageHeight)
    $scaledGraphics = [Drawing.Graphics]::FromImage($scaled)
    $scaledGraphics.DrawImage($bitmap, 0, 0, $imageWidth, $imageHeight)
    $scaled.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    if ($stream.Length -gt 4194304) { throw 'Screenshot is too large. Resize the window and try again.' }
    @{ window_id=$request.window_id; process_id=$processId; title=[FileyDesktop]::Title($window); width=$imageWidth; height=$imageHeight;
      bounds=@{ x=$rect.Left; y=$rect.Top; width=$width; height=$height };
      capture_bounds=@{ x=$captureX; y=$captureY; width=$captureWidth; height=$captureHeight };
      image=@{ dataBase64=[Convert]::ToBase64String($stream.ToArray()); mediaType='image/png' } } | ConvertTo-Json -Depth 5 -Compress
  } finally {
    $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose()
    if ($scaledGraphics) { $scaledGraphics.Dispose() }; if ($scaled) { $scaled.Dispose() }
  }
  exit
}

$expected = $request.bounds
if ($processId -ne $request.process_id) { throw 'The selected window was replaced. Take a new screenshot before acting.' }
if ($rect.Left -ne $expected.x -or $rect.Top -ne $expected.y -or $width -ne $expected.width -or $height -ne $expected.height) { throw 'The window moved or resized. Take a new screenshot before acting.' }
[FileyDesktop]::Target = $window
[FileyDesktop]::Bounds = $rect
[FileyDesktop]::ProcessId = $processId
[FileyDesktop]::CheckStop()
if ($request.action -eq 'click' -or $request.action -eq 'scroll') {
  if (-not [FileyDesktop]::SetCursorPos([int]$request.screen_x, [int]$request.screen_y)) { throw 'Windows blocked cursor movement. No click or scroll was sent.' }
  $cursor = [Windows.Forms.Cursor]::Position
  if ($cursor.X -ne $request.screen_x -or $cursor.Y -ne $request.screen_y) { throw 'The cursor could not reach the selected point. No click or scroll was sent.' }
}
switch ($request.action) {
  'click' { [FileyDesktop]::Click($request.button -eq 'right', [bool]$request.double_click) }
  'type' { [FileyDesktop]::Type([string]$request.text) }
  'scroll' { [FileyDesktop]::Scroll([int]$request.delta) }
  'key' { [FileyDesktop]::Press([uint16]$request.virtual_key, [bool]$request.control) }
  default { throw 'Unsupported computer action.' }
}
@{ ok=$true; action=$request.action; window_id=$request.window_id; needs_screenshot=$true } | ConvertTo-Json -Compress
