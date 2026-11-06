// Windows APIs used by the passkey provider. Layouts follow pluginauthenticator.idl and webauthnplugin.h
// from https://github.com/microsoft/webauthn (MIT).
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;

namespace Boltwork.Passkeys;

[StructLayout(LayoutKind.Sequential)]
unsafe struct PluginOperationRequest
{
    public nint hWnd;
    public Guid transactionId;
    public uint cbRequestSignature;
    public byte* pbRequestSignature;
    public int requestType;           // 1 = CTAP2 CBOR
    public uint cbEncodedRequest;
    public byte* pbEncodedRequest;
}

[StructLayout(LayoutKind.Sequential)]
unsafe struct PluginOperationResponse
{
    public uint cbEncodedResponse;
    public byte* pbEncodedResponse;   // CoTaskMemAlloc'd; Windows frees it
}

[StructLayout(LayoutKind.Sequential)]
unsafe struct PluginCancelRequest
{
    public Guid transactionId;
    public uint cbRequestSignature;
    public byte* pbRequestSignature;
}

[GeneratedComInterface]
[Guid("d26bcf6f-b54c-43ff-9f06-d5bf148625f7")]
unsafe partial interface IPluginAuthenticator
{
    [PreserveSig] int MakeCredential(PluginOperationRequest* request, PluginOperationResponse* response);
    [PreserveSig] int GetAssertion(PluginOperationRequest* request, PluginOperationResponse* response);
    [PreserveSig] int CancelOperation(PluginCancelRequest* request);
    [PreserveSig] int GetLockStatus(int* lockStatus); // 0 = locked, 1 = unlocked
}

[GeneratedComInterface]
[Guid("00000001-0000-0000-C000-000000000046")]
unsafe partial interface IClassFactory
{
    [PreserveSig] int CreateInstance(nint outer, Guid* riid, nint* ppv);
    [PreserveSig] int LockServer([MarshalAs(UnmanagedType.Bool)] bool fLock);
}

[StructLayout(LayoutKind.Sequential)]
unsafe struct AddAuthenticatorOptions
{
    public char* pwszAuthenticatorName;
    public Guid* rclsid;
    public char* pwszPluginRpId;
    public char* pwszLightThemeLogoSvg;
    public char* pwszDarkThemeLogoSvg;
    public uint cbAuthenticatorInfo;
    public byte* pbAuthenticatorInfo;
    public uint cSupportedRpIds;
    public char** ppwszSupportedRpIds;
}

[StructLayout(LayoutKind.Sequential)]
unsafe struct AddAuthenticatorResponse
{
    public uint cbOpSignPubKey;
    public byte* pbOpSignPubKey;
}

[StructLayout(LayoutKind.Sequential)]
unsafe struct PluginCredentialDetails
{
    public uint cbCredentialId;
    public byte* pbCredentialId;
    public char* pwszRpId;
    public char* pwszRpName;
    public uint cbUserId;
    public byte* pbUserId;
    public char* pwszUserName;
    public char* pwszUserDisplayName;
}

static unsafe partial class Native
{
    const string WebAuthn = "webauthn.dll";

    [LibraryImport(WebAuthn)] public static partial int WebAuthNPluginAddAuthenticator(AddAuthenticatorOptions* options, AddAuthenticatorResponse** response);
    [LibraryImport(WebAuthn)] public static partial void WebAuthNPluginFreeAddAuthenticatorResponse(AddAuthenticatorResponse* response);
    [LibraryImport(WebAuthn)] public static partial int WebAuthNPluginRemoveAuthenticator(Guid* rclsid);
    [LibraryImport(WebAuthn)] public static partial int WebAuthNPluginGetAuthenticatorState(Guid* rclsid, int* state);
    [LibraryImport(WebAuthn)] public static partial int WebAuthNPluginAuthenticatorAddCredentials(Guid* rclsid, uint count, PluginCredentialDetails* details);
    [LibraryImport(WebAuthn)] public static partial int WebAuthNPluginAuthenticatorRemoveAllCredentials(Guid* rclsid);
    [LibraryImport(WebAuthn)] public static partial int WebAuthNPluginGetOperationSigningPublicKey(Guid* rclsid, uint* cb, byte** pb);
    [LibraryImport(WebAuthn)] public static partial void WebAuthNPluginFreePublicKeyResponse(byte* pb);

    [LibraryImport("ole32.dll")] public static partial int CoInitializeEx(nint reserved, uint coinit);
    [LibraryImport("ole32.dll")] public static partial int CoRegisterClassObject(Guid* rclsid, nint pUnk, uint clsContext, uint flags, uint* cookie);
    [LibraryImport("ole32.dll")] public static partial int CoRevokeClassObject(uint cookie);

    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static partial bool AllowSetForegroundWindow(int processId);

    public const uint COINIT_MULTITHREADED = 0x0;
    public const uint CLSCTX_LOCAL_SERVER = 0x4;
    public const uint REGCLS_MULTIPLEUSE = 1;

    public const int S_OK = 0;
    public const int E_FAIL = unchecked((int)0x80004005);
    public const int E_INVALIDARG = unchecked((int)0x80070057);
    public const int E_NOINTERFACE = unchecked((int)0x80004002);
    public const int CLASS_E_NOAGGREGATION = unchecked((int)0x80040110);
    public const int NTE_USER_CANCELLED = unchecked((int)0x80090036);
    public const int NTE_EXISTS = unchecked((int)0x8009000F);
    public const int NTE_NOT_SUPPORTED = unchecked((int)0x80090029);
    public const int NTE_NOT_FOUND = unchecked((int)0x80090011);
    public const int NTE_BAD_SIGNATURE = unchecked((int)0x80090006);
}
