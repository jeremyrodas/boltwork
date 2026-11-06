// Strongroom's Windows passkey provider.
//
// Windows starts this (packaged) program as a COM server when you pick Strongroom in its passkey dialog,
// and calls IPluginAuthenticator with CTAP2 requests. Each request is checked against Windows' signing
// key, so other programs can't call us pretending to be Windows, and then relayed to the Strongroom app
// over a local pipe. The app asks you, does the cryptography with the passkeys in your vault, and replies.
//
// The same program has a few commands the Strongroom app runs through its execution alias
// (strongroom-passkeys.exe), because Windows only accepts them from the packaged app:
//   register     add Strongroom as a passkey provider     (stdin: {"info": base64 getInfo, "logo": base64 svg})
//   unregister   remove it
//   status       {"state": "enabled" | "disabled" | "not-registered"}
//   sync         replace the passkey list Windows shows   (stdin: [{credentialId, rpId, rpName, userId, userName, userDisplayName}])
using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Strongroom.Passkeys;

static unsafe class Program
{
    public static readonly Guid Clsid = new("43df1c13-2d67-44cb-836b-ed22142063fc");
    public const string PipeName = "strongroom-passkeys";
    static readonly StrategyBasedComWrappers ComWrappers = new();
    static readonly ManualResetEventSlim Done = new();
    public static long LastActivity = Environment.TickCount64;
    public static int Busy;

    [STAThread]
    static int Main(string[] args)
    {
        var cmd = args.FirstOrDefault()?.ToLowerInvariant() ?? "";
        try
        {
            return cmd switch
            {
                "register" => Register(),
                "unregister" => Out(new JsonObject { ["hr"] = Hr(Unregister()) }),
                "status" => Status(),
                "sync" => Sync(),
                _ when cmd.Contains("pluginactivated") || cmd.Contains("embedding") => Serve(),
                _ => Out(new JsonObject { ["error"] = "usage: register | unregister | status | sync" }, 2),
            };
        }
        catch (Exception e)
        {
            Log($"fatal: {e}");
            return Out(new JsonObject { ["error"] = e.Message }, 1);
        }
    }

    // ---------- COM server ----------

    static int Serve()
    {
        // Calls arrive on RPC threads; nothing here needs a UI thread.
        new Thread(() =>
        {
            Native.CoInitializeEx(0, Native.COINIT_MULTITHREADED);
            nint factory = ComWrappers.GetOrCreateComInterfaceForObject(new ClassFactory(), CreateComInterfaceFlags.None);
            uint cookie;
            var clsid = Clsid;
            int hr = Native.CoRegisterClassObject(&clsid, factory, Native.CLSCTX_LOCAL_SERVER, Native.REGCLS_MULTIPLEUSE, &cookie);
            Log($"serving, register hr={Hr(hr)}");
            if (hr < 0) { Done.Set(); return; }
            // Stay up while Windows is using us; leave a few minutes after the last request.
            while (!Done.Wait(5000))
                if (Busy == 0 && Environment.TickCount64 - LastActivity > 5 * 60_000) break;
            Native.CoRevokeClassObject(cookie);
            Done.Set();
        }) { IsBackground = false }.Start();
        Done.Wait();
        return 0;
    }

    public static nint Wrap(object o) => ComWrappers.GetOrCreateComInterfaceForObject(o, CreateComInterfaceFlags.None);

    // ---------- registration with Windows ----------

    static int Register()
    {
        var input = JsonNode.Parse(Console.In.ReadToEnd())!;
        byte[] info = Convert.FromBase64String((string)input["info"]!);
        string logo = (string?)input["logo"] ?? "";
        // Windows wants an RP ID for the provider itself (used if it ever signs in to its own service).
        string rpId = (string?)input["rpId"] ?? "strongroom.app";
        var clsid = Clsid;
        fixed (char* name = "Strongroom")
        fixed (char* pRpId = rpId)
        fixed (char* svg = logo)
        fixed (byte* pInfo = info)
        {
            var opts = new AddAuthenticatorOptions
            {
                pwszAuthenticatorName = name, rclsid = &clsid, pwszPluginRpId = rpId.Length > 0 ? pRpId : null,
                pwszLightThemeLogoSvg = logo.Length > 0 ? svg : null, pwszDarkThemeLogoSvg = logo.Length > 0 ? svg : null,
                cbAuthenticatorInfo = (uint)info.Length, pbAuthenticatorInfo = pInfo,
            };
            AddAuthenticatorResponse* resp = null;
            int hr = Native.WebAuthNPluginAddAuthenticator(&opts, &resp);
            if (hr == Native.NTE_EXISTS)
            {
                // Already registered: refresh it so name, logo and capabilities are current.
                Unregister();
                hr = Native.WebAuthNPluginAddAuthenticator(&opts, &resp);
            }
            if (resp != null) Native.WebAuthNPluginFreeAddAuthenticatorResponse(resp);
            Log($"register hr={Hr(hr)}");
            return Out(new JsonObject { ["hr"] = Hr(hr) }, hr < 0 ? 1 : 0);
        }
    }

    static int Unregister() { var c = Clsid; return Native.WebAuthNPluginRemoveAuthenticator(&c); }

    static int Status()
    {
        var c = Clsid;
        int state;
        int hr = Native.WebAuthNPluginGetAuthenticatorState(&c, &state);
        return Out(new JsonObject { ["state"] = hr < 0 ? "not-registered" : state == 1 ? "enabled" : "disabled", ["hr"] = Hr(hr) });
    }

    static int Sync()
    {
        var list = JsonNode.Parse(Console.In.ReadToEnd())!.AsArray();
        var c = Clsid;
        int hr = Native.WebAuthNPluginAuthenticatorRemoveAllCredentials(&c);
        if (list.Count == 0) return Out(new JsonObject { ["hr"] = Hr(hr), ["count"] = 0 });
        var handles = new List<GCHandle>();
        try
        {
            var details = new PluginCredentialDetails[list.Count];
            for (int i = 0; i < list.Count; i++)
            {
                var p = list[i]!;
                byte[] id = B64u((string)p["credentialId"]!), user = B64u((string)p["userId"]!);
                details[i] = new PluginCredentialDetails
                {
                    cbCredentialId = (uint)id.Length, pbCredentialId = (byte*)Pin(id, handles),
                    pwszRpId = (char*)Pin(Z((string?)p["rpId"]), handles), pwszRpName = (char*)Pin(Z((string?)p["rpName"] ?? (string?)p["rpId"]), handles),
                    cbUserId = (uint)user.Length, pbUserId = (byte*)Pin(user, handles),
                    pwszUserName = (char*)Pin(Z((string?)p["userName"]), handles), pwszUserDisplayName = (char*)Pin(Z((string?)p["userDisplayName"] ?? (string?)p["userName"]), handles),
                };
            }
            fixed (PluginCredentialDetails* pd = details) hr = Native.WebAuthNPluginAuthenticatorAddCredentials(&c, (uint)details.Length, pd);
            return Out(new JsonObject { ["hr"] = Hr(hr), ["count"] = list.Count }, hr < 0 ? 1 : 0);
        }
        finally { foreach (var h in handles) h.Free(); }
    }

    static nint Pin(object o, List<GCHandle> handles) { var h = GCHandle.Alloc(o, GCHandleType.Pinned); handles.Add(h); return h.AddrOfPinnedObject(); }
    static char[] Z(string? s) => ((s ?? "") + "\0").ToCharArray();

    // ---------- checking that a request really came from Windows ----------

    public static bool FromWindows(byte* data, uint cbData, byte* sig, uint cbSig)
    {
        if (data == null || sig == null || cbSig == 0) return false;
        var c = Clsid;
        uint cbKey;
        byte* pbKey;
        if (Native.WebAuthNPluginGetOperationSigningPublicKey(&c, &cbKey, &pbKey) < 0 || pbKey == null) return false;
        try
        {
            var blob = new ReadOnlySpan<byte>(pbKey, (int)cbKey).ToArray();
            var hash = SHA256.HashData(new ReadOnlySpan<byte>(data, (int)cbData));
            var signature = new ReadOnlySpan<byte>(sig, (int)cbSig).ToArray();
            uint magic = BitConverter.ToUInt32(blob, 0);
            if (magic == 0x31415352) // BCRYPT_RSAPUBLIC_MAGIC
            {
                using var rsa = new RSACng(CngKey.Import(blob, CngKeyBlobFormat.GenericPublicBlob));
                return rsa.VerifyHash(hash, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pss);
            }
            using var ec = new ECDsaCng(CngKey.Import(blob, CngKeyBlobFormat.EccPublicBlob));
            return ec.VerifyHash(hash, signature);
        }
        catch (Exception e) { Log($"signature check failed: {e.Message}"); return false; }
        finally { Native.WebAuthNPluginFreePublicKeyResponse(pbKey); }
    }

    // ---------- talking to the Strongroom app ----------

    /// <summary>Sends one request to the app and waits for its reply, starting the app if it isn't running.</summary>
    public static JsonNode? Ask(JsonObject msg, int timeoutMs)
    {
        using var pipe = Connect(msg["op"]?.ToString() != "lock");
        if (pipe == null) return null;
        var line = Encoding.UTF8.GetBytes(msg.ToJsonString() + "\n");
        pipe.Write(line);
        pipe.Flush();
        var buf = new List<byte>();
        var chunk = new byte[64 * 1024];
        var task = Task.Run(() =>
        {
            int n;
            while ((n = pipe.Read(chunk, 0, chunk.Length)) > 0)
            {
                buf.AddRange(chunk.AsSpan(0, n).ToArray());
                if (chunk[n - 1] == (byte)'\n') break;
            }
        });
        if (!task.Wait(timeoutMs)) { Log("app didn't answer in time"); return null; }
        return buf.Count == 0 ? null : JsonNode.Parse(Encoding.UTF8.GetString(buf.ToArray()));
    }

    static NamedPipeClientStream? Connect(bool launchIfNeeded)
    {
        var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut);
        try { pipe.Connect(1500); return pipe; } catch { pipe.Dispose(); }
        if (!launchIfNeeded || !LaunchApp()) return null;
        var until = Environment.TickCount64 + 45_000;
        while (Environment.TickCount64 < until)
        {
            pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut);
            try { pipe.Connect(1000); return pipe; } catch { pipe.Dispose(); Thread.Sleep(500); }
        }
        return null;
    }

    /// <summary>Starts Strongroom using the launch details it saved the last time it ran.</summary>
    static bool LaunchApp()
    {
        try
        {
            var file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Strongroom", "passkey-provider.json");
            var j = JsonNode.Parse(File.ReadAllText(file))!;
            var psi = new ProcessStartInfo((string)j["command"]!) { UseShellExecute = false, WorkingDirectory = (string?)j["cwd"] ?? "" };
            foreach (var a in j["args"]?.AsArray() ?? []) psi.ArgumentList.Add((string)a!);
            Process.Start(psi);
            Log("started Strongroom");
            return true;
        }
        catch (Exception e) { Log($"couldn't start Strongroom: {e.Message}"); return false; }
    }

    // ---------- helpers ----------

    public static byte[] B64u(string s) => Convert.FromBase64String(s.Replace('-', '+').Replace('_', '/').PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    public static string Hr(int hr) => $"0x{hr:X8}";

    static int Out(JsonNode n, int code = 0) { Console.Out.Write(n.ToJsonString()); Console.Out.Flush(); return code; }

    public static void Log(string s)
    {
        try
        {
            var dir = Path.Combine(Path.GetTempPath(), "strongroom-passkeys");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "provider.log"), $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{Environment.ProcessId}] {s}\n");
        }
        catch { /* logging is best effort */ }
    }
}

[GeneratedComClass]
sealed unsafe partial class ClassFactory : IClassFactory
{
    public int CreateInstance(nint outer, Guid* riid, nint* ppv)
    {
        *ppv = 0;
        if (outer != 0) return Native.CLASS_E_NOAGGREGATION;
        nint unk = Program.Wrap(new PluginAuthenticator());
        try { return Marshal.QueryInterface(unk, in *riid, out *ppv); }
        finally { Marshal.Release(unk); }
    }

    public int LockServer(bool fLock) => Native.S_OK;
}

[GeneratedComClass]
sealed unsafe partial class PluginAuthenticator : IPluginAuthenticator
{
    public int MakeCredential(PluginOperationRequest* request, PluginOperationResponse* response) => Operate("make", request, response);
    public int GetAssertion(PluginOperationRequest* request, PluginOperationResponse* response) => Operate("get", request, response);

    int Operate(string op, PluginOperationRequest* request, PluginOperationResponse* response)
    {
        Interlocked.Increment(ref Program.Busy);
        Program.LastActivity = Environment.TickCount64;
        try
        {
            if (request == null || response == null || request->pbEncodedRequest == null || request->requestType != 1) return Native.E_INVALIDARG;
            if (!Program.FromWindows(request->pbEncodedRequest, request->cbEncodedRequest, request->pbRequestSignature, request->cbRequestSignature))
            {
                Program.Log($"{op}: request signature didn't verify; refusing");
                return Native.NTE_BAD_SIGNATURE;
            }
            var bytes = new ReadOnlySpan<byte>(request->pbEncodedRequest, (int)request->cbEncodedRequest).ToArray();
            // Let the app bring its approval prompt to the front.
            Native.AllowSetForegroundWindow(-1);
            var reply = Program.Ask(new JsonObject
            {
                ["op"] = op, ["request"] = Convert.ToBase64String(bytes),
                ["transaction"] = request->transactionId.ToString(), ["hwnd"] = request->hWnd.ToInt64(),
            }, 5 * 60_000);
            Program.Log($"{op}: request {bytes.Length} bytes (first {bytes[0]:X2}), reply {reply?.ToJsonString().Length ?? 0} chars");
            if (reply == null) return Native.NTE_NOT_FOUND;
            var error = (string?)reply["error"];
            if (error != null)
            {
                return error switch
                {
                    "cancelled" => Native.NTE_USER_CANCELLED,
                    "exists" => Native.NTE_EXISTS,
                    "not-supported" => Native.NTE_NOT_SUPPORTED,
                    "not-found" => Native.NTE_NOT_FOUND,
                    _ => Native.E_FAIL,
                };
            }
            var outBytes = Convert.FromBase64String((string)reply["response"]!);
            var mem = (byte*)Marshal.AllocCoTaskMem(outBytes.Length);
            outBytes.CopyTo(new Span<byte>(mem, outBytes.Length));
            response->cbEncodedResponse = (uint)outBytes.Length;
            response->pbEncodedResponse = mem;
            return Native.S_OK;
        }
        catch (Exception e)
        {
            Program.Log($"{op} failed: {e}");
            return Native.E_FAIL;
        }
        finally
        {
            Interlocked.Decrement(ref Program.Busy);
            Program.LastActivity = Environment.TickCount64;
        }
    }

    public int CancelOperation(PluginCancelRequest* request)
    {
        if (request != null) Program.Ask(new JsonObject { ["op"] = "cancel", ["transaction"] = request->transactionId.ToString() }, 5000);
        return Native.S_OK;
    }

    public int GetLockStatus(int* lockStatus)
    {
        Program.LastActivity = Environment.TickCount64;
        var reply = Program.Ask(new JsonObject { ["op"] = "lock" }, 5000);
        *lockStatus = reply?["locked"]?.GetValue<bool>() == false ? 1 : 0;
        return Native.S_OK;
    }
}
