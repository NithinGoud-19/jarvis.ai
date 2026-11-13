/**
 * A Windows notification (the pop-up at the bottom right), with no extra software.
 *
 * Windows PowerShell 5.1 can use the same "toast" API that Windows apps use. Toasts must
 * belong to an app, so we borrow PowerShell's own app id (the pop-up says "Windows PowerShell").
 * The title/text go in as environment variables and are XML-escaped inside the script,
 * so no reminder text can ever change the script (see runPowerShell).
 *
 * scenario='reminder' + a Dismiss button = the pop-up STAYS on screen until you click it
 * (a normal toast slides away after ~5 s, easy to miss). Windows requires at least one
 * button for this mode; activationType='system' uses Windows' own built-in Dismiss.
 */
import { runPowerShell } from "../tools/exec.js";

const TOAST_SCRIPT = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$title = [System.Security.SecurityElement]::Escape($env:JARVIS_TITLE)
$body  = [System.Security.SecurityElement]::Escape($env:JARVIS_BODY)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast scenario='reminder'><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual><actions><action activationType='system' arguments='dismiss' content=''/></actions><audio src='ms-winsoundevent:Notification.Looping.Alarm' loop='false'/></toast>")
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;

export async function showWindowsNotification(title: string, body: string): Promise<void> {
  await runPowerShell(TOAST_SCRIPT, { JARVIS_TITLE: title.slice(0, 200), JARVIS_BODY: body.slice(0, 500) });
}
