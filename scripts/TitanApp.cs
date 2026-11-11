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
                for (int i = 0; i < 25; i++)
                {
                    Thread.Sleep(200);
                    if (IsServerRunning()) break;
                }
            }

            // 3. Send file if provided
            if (!string.IsNullOrEmpty(fileToShare) && File.Exists(fileToShare))
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
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\node\node.exe")
            };
            foreach (var path in candidates)
            {
                if (File.Exists(path)) return path;
            }
            return "node.exe";
        }

        static void StartServer(string baseDir)
        {
            try
            {
                string serverScript = Path.Combine(baseDir, "server", "server.js");
                if (!File.Exists(serverScript))
                {
                    // Fallback to parent directory if in subfolder
                    serverScript = Path.Combine(Directory.GetParent(baseDir).FullName, "server", "server.js");
                }

                var psi = new ProcessStartInfo
                {
                    FileName = FindNodeExe(),
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = Path.GetDirectoryName(serverScript),
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
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(ServerUrl + "/api/cli/share");
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 2000;

                string json = "{\"filePath\":\"" + path.Replace("\\", "\\\\") + "\"}";
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                req.ContentLength = bytes.Length;

                using (var stream = req.GetRequestStream())
                {
                    stream.Write(bytes, 0, bytes.Length);
                }
                using (req.GetResponse()) { }
            }
            catch { }
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

