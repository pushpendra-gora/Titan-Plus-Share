using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace TitanPlusShare
{
    static class Program
    {
        private const string ServerUrl = "http://127.0.0.1:51733";

        [STAThread]
        static void Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;

            // 1. If file argument provided, send via CLI share
            string fileToShare = args != null && args.Length > 0 ? args[0] : null;

            // 2. Ensure server is running
            if (!IsServerRunning())
            {
                StartServer(baseDir);
                // Wait for server to become ready
                for (int i = 0; i < 35; i++)
                {
                    Thread.Sleep(200);
                    if (IsServerRunning()) break;
                }
            }

            // 3. Send file or folder if provided
            if (!string.IsNullOrEmpty(fileToShare) && (File.Exists(fileToShare) || Directory.Exists(fileToShare)))
            {
                SendFileToApp(fileToShare);
            }

            // 4. Launch clean native application window
            LaunchAppWindow();
        }

        static bool IsServerRunning()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(ServerUrl + "/api/status");
                req.Timeout = 1000;
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        static string FindNodeExe()
        {
            string[] candidates = new string[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"npm\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @"scoop\apps\nodejs\current\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @".nvm\current\node.exe")
            };
            foreach (var path in candidates)
            {
                if (File.Exists(path)) return path;
            }

            // Check PATH environment variable
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (!string.IsNullOrEmpty(pathEnv))
            {
                string[] paths = pathEnv.Split(';');
                foreach (string p in paths)
                {
                    string trimmed = p.Trim();
                    if (!string.IsNullOrEmpty(trimmed))
                    {
                        string fullPath = Path.Combine(trimmed, "node.exe");
                        if (File.Exists(fullPath)) return fullPath;
                    }
                }
            }

            // Test if "node" is callable in current environment
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "node.exe",
                    Arguments = "-v",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                using (var proc = Process.Start(psi))
                {
                    proc.WaitForExit(1500);
                    return "node.exe";
                }
            }
            catch {}

            return null;
        }

        static void StartServer(string baseDir)
        {
            try
            {
                string nodePath = FindNodeExe();
                if (string.IsNullOrEmpty(nodePath))
                {
                    DialogResult dr = MessageBox.Show(
                        "Node.js is required to run Titan Plus Share on this laptop.\n\n" +
                        "Node.js was not found on this computer.\n\n" +
                        "Would you like to open the official Node.js website (https://nodejs.org) to install it now?",
                        "Titan Plus Share - Node.js Required",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Information);
                    if (dr == DialogResult.Yes)
                    {
                        Process.Start(new ProcessStartInfo("https://nodejs.org") { UseShellExecute = true });
                    }
                    return;
                }

                string serverScript = Path.Combine(baseDir, "server", "server.js");
                if (!File.Exists(serverScript))
                {
                    // Fallback to parent directory if in subfolder
                    serverScript = Path.Combine(Directory.GetParent(baseDir).FullName, "server", "server.js");
                }
                if (!File.Exists(serverScript))
                {
                    MessageBox.Show("Could not find server.js at: " + serverScript, "Titan Plus Share", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                string serverDir = Path.GetDirectoryName(serverScript);
                string nodeModulesDir = Path.Combine(serverDir, "node_modules");

                // Auto-install server dependencies if missing on a new laptop!
                if (!Directory.Exists(nodeModulesDir))
                {
                    var npmPsi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = "/c npm install --omit=dev",
                        WorkingDirectory = serverDir,
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    using (var npmProc = Process.Start(npmPsi))
                    {
                        npmProc.WaitForExit(90000); // Wait up to 90 seconds
                    }
                }

                var psi = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = serverDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Could not start Titan Plus Share server: " + ex.Message, "Titan Plus Share", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        static void SendFileToApp(string path)
        {
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create(ServerUrl + "/api/cli/share");
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Timeout = 3000;

                    string escapedPath = path.Replace("\\", "\\\\").Replace("\"", "\\\"");
                    string json = "{\"filePath\":\"" + escapedPath + "\"}";
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    req.ContentLength = bytes.Length;

                    using (var stream = req.GetRequestStream())
                    {
                        stream.Write(bytes, 0, bytes.Length);
                    }
                    using (var resp = req.GetResponse())
                    {
                        return; // Successfully received by Titan Plus Share server
                    }
                }
                catch
                {
                    Thread.Sleep(300);
                }
            }
        }

        static void LaunchAppWindow()
        {
            try
            {
                // Try Edge Standalone App Window
                string edgePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe");
                if (!File.Exists(edgePath))
                {
                    edgePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe");
                }

                if (File.Exists(edgePath))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = edgePath,
                        Arguments = "--app=" + ServerUrl + " --window-size=1100,740",
                        UseShellExecute = true
                    });
                    return;
                }

                // Try Chrome Standalone App Window
                string chromePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe");
                if (File.Exists(chromePath))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = chromePath,
                        Arguments = "--app=" + ServerUrl + " --window-size=1100,740",
                        UseShellExecute = true
                    });
                    return;
                }

                // Fallback to default browser
                Process.Start(new ProcessStartInfo
                {
                    FileName = ServerUrl,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to open application window: " + ex.Message, "Titan Plus Share", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}

