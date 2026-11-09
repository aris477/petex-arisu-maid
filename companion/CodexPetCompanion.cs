using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

internal static class CodexPetCompanion
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(
        string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr hObject);

    private const string MutexName = "Local\\ArisMaidCodexPetCompanion";
    private static readonly string BaseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    private static readonly string PetexExe = Path.Combine(BaseDir, "Petex.exe");
    private static readonly string DataDir = Path.Combine(BaseDir, "data");
    private static readonly string DisableFlag = Path.Combine(DataDir, "companion-disabled");
    private static readonly string LogFile = Path.Combine(DataDir, "companion.log");

    [STAThread]
    private static int Main(string[] args)
    {
        bool selfTest = Array.Exists(args, delegate(string s) { return s == "--self-test"; });
        if (!File.Exists(PetexExe)) return 1;
        Directory.CreateDirectory(DataDir);
        if (selfTest)
        {
            bool codexLive = IsOfficialCodexRunning();
            bool petLive = IsOurPetexRunning();
            Log("Self-test OK: codexRunning=" + codexLive + ", petRunning=" + petLive);
            return 0;
        }

        bool created;
        using (Mutex mutex = new Mutex(true, MutexName, out created))
        {
            if (!created) return 0;
            try
            {
                RunLoop();
                return 0;
            }
            finally
            {
                try { mutex.ReleaseMutex(); } catch { }
            }
        }
    }

    private static void RunLoop()
    {
        bool launchedInSession = IsOurPetexRunning();
        DateTime? codexAbsentSince = null;
        Log("CodexPetCompanion started. Initial pet running=" + launchedInSession);

        while (!File.Exists(DisableFlag))
        {
            try
            {
                bool codexRunning = IsOfficialCodexRunning();
                bool petRunning = IsOurPetexRunning();

                if (codexRunning)
                {
                    codexAbsentSince = null;
                    if (petRunning)
                    {
                        launchedInSession = true;
                    }
                    else if (!launchedInSession)
                    {
                        StartPetex();
                        launchedInSession = true;
                    }
                }
                else
                {
                    if (!codexAbsentSince.HasValue) codexAbsentSince = DateTime.UtcNow;
                    if ((DateTime.UtcNow - codexAbsentSince.Value).TotalSeconds >= 15.0)
                    {
                        if (petRunning) StopOurPetex();
                        launchedInSession = false;
                    }
                }
            }
            catch (Exception ex)
            {
                Log("Tick error: " + ex.Message);
            }
            Thread.Sleep(5000);
        }
        Log("Companion disabled flag detected; exiting.");
    }

    private static bool IsOfficialCodexPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        string name = Path.GetFileName(path);
        bool isCodexApp = path.IndexOf("\\WindowsApps\\OpenAI.Codex_", StringComparison.OrdinalIgnoreCase) >= 0
            && (name.Equals("ChatGPT.exe", StringComparison.OrdinalIgnoreCase)
                || name.Equals("Codex.exe", StringComparison.OrdinalIgnoreCase));
        return isCodexApp;
    }

    private static bool IsOfficialCodexRunning()
    {
        foreach (string procName in new[] { "ChatGPT", "Codex" })
        {
            foreach (Process p in Process.GetProcessesByName(procName))
            {
                using (p)
                {
                    try
                    {
                        if (IsOfficialCodexPath(p.MainModule.FileName)) return true;
                    }
                    catch { }
                }
            }
        }
        return false;
    }

    private static bool IsOurPetexRunning()
    {
        string expected = Path.GetFullPath(PetexExe);
        foreach (Process p in Process.GetProcessesByName("Petex"))
        {
            using (p)
            {
                try
                {
                    if (string.Equals(Path.GetFullPath(p.MainModule.FileName), expected, StringComparison.OrdinalIgnoreCase))
                        return true;
                }
                catch { }
            }
        }
        return false;
    }

    private static void StartPetex()
    {
        Environment.SetEnvironmentVariable("PEDEX_DATA_DIR", DataDir);
        string cmdLine = "\"" + PetexExe + "\" --no-sandbox \"--user-data-dir=" + DataDir + "\" --hidden";
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = "Winsta0\\Default";
        PROCESS_INFORMATION pi;
        if (CreateProcessW(PetexExe, cmdLine, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, BaseDir, ref si, out pi))
        {
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            Log("Started Petex on Winsta0\\Default PID " + pi.dwProcessId);
        }
        else
        {
            Log("CreateProcessW failed with error " + Marshal.GetLastWin32Error());
        }
    }

    private static void StopOurPetex()
    {
        string expected = Path.GetFullPath(PetexExe);
        foreach (Process p in Process.GetProcessesByName("Petex"))
        {
            using (p)
            {
                try
                {
                    if (string.Equals(Path.GetFullPath(p.MainModule.FileName), expected, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                    }
                }
                catch { }
            }
        }
        Log("Stopped Petex after Codex exited.");
    }

    private static void Log(string msg)
    {
        try
        {
            if (File.Exists(LogFile) && new FileInfo(LogFile).Length > 65536) File.WriteAllText(LogFile, "");
            File.AppendAllText(LogFile, DateTime.Now.ToString("o") + " " + msg + Environment.NewLine);
        }
        catch { }
    }
}
