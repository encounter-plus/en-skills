param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("get", "get-stream", "set", "delete")]
    [string]$Action,

    [Parameter(Mandatory = $true, Position = 1)]
    [string]$Target
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class EnSkillsCredentialManager
{
    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;
    private const int ERROR_NOT_FOUND = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, int flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, int type, int flags);

    [DllImport("advapi32.dll", SetLastError = false)]
    private static extern void CredFree(IntPtr buffer);

    public static void Set(string target, string secret)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(secret);
        IntPtr blob = Marshal.AllocCoTaskMem(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            CREDENTIAL credential = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC,
                TargetName = target,
                CredentialBlobSize = bytes.Length,
                CredentialBlob = blob,
                Persist = CRED_PERSIST_LOCAL_MACHINE,
                UserName = target
            };
            if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            for (int i = 0; i < bytes.Length; i++) bytes[i] = 0;
            Marshal.FreeCoTaskMem(blob);
        }
    }

    public static string Get(string target)
    {
        IntPtr pointer;
        if (!CredRead(target, CRED_TYPE_GENERIC, 0, out pointer))
        {
            int code = Marshal.GetLastWin32Error();
            if (code == ERROR_NOT_FOUND) return null;
            throw new Win32Exception(code);
        }
        try
        {
            CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
            byte[] bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.UTF8.GetString(bytes);
        }
        finally
        {
            CredFree(pointer);
        }
    }

    public static bool Delete(string target)
    {
        if (CredDelete(target, CRED_TYPE_GENERIC, 0)) return true;
        int code = Marshal.GetLastWin32Error();
        if (code == ERROR_NOT_FOUND) return false;
        throw new Win32Exception(code);
    }
}
"@

switch ($Action) {
    "get-stream" {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        while ($null -ne ($requestLine = [Console]::In.ReadLine())) {
            if ($requestLine -ne "read") { exit 1 }
            try {
                $value = [EnSkillsCredentialManager]::Get($Target)
                $reply = @{ ok = $true; value = $value } | ConvertTo-Json -Compress
            } catch {
                # Neither exception text nor the secret may enter diagnostics.
                $reply = '{"ok":false}'
            }
            [Console]::Out.WriteLine($reply)
            [Console]::Out.Flush()
            $value = $null
            $reply = $null
        }
    }
    "get" {
        $value = [EnSkillsCredentialManager]::Get($Target)
        if ($null -eq $value) { exit 2 }
        [Console]::Out.Write($value)
    }
    "set" {
        $value = [Console]::In.ReadToEnd()
        if ([string]::IsNullOrEmpty($value)) { throw "Refusing to store an empty credential" }
        [EnSkillsCredentialManager]::Set($Target, $value)
    }
    "delete" {
        if (-not [EnSkillsCredentialManager]::Delete($Target)) { exit 2 }
    }
}
