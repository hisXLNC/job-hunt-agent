package main

import (
	"context"
	_ "embed"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"time"

	"fyne.io/systray"

	"jobhunt/internal/engine"
	"jobhunt/internal/trace"
)

//go:embed tray.ico
var trayIcon []byte

// runTray puts Job Hunt's icon by the clock: its menu opens the window,
// searches now, looks for an update or stops the program.
func runTray(ctx context.Context, stop func(), url, dir string, e *engine.Engine) {
	go func() {
		defer func() {
			if p := recover(); p != nil {
				trace.Log("problem", "the tray icon stopped: %v", p)
			}
		}()
		runtime.LockOSThread()
		systray.Run(func() {
			systray.SetIcon(trayIcon)
			systray.SetTitle("Job Hunt")
			systray.SetTooltip("Job Hunt is watching for new roles")
			open := systray.AddMenuItem("Open Job Hunt", "Shows Job Hunt's window")
			search := systray.AddMenuItem("Search for jobs now", "Starts a full search")
			inbox := systray.AddMenuItem("Check my inbox now", "Reads new replies from employers")
			update := systray.AddMenuItem("Check for updates", "Looks for a newer version and installs it")
			systray.AddSeparator()
			startOn, canStart := startsWithWindows()
			start := systray.AddMenuItemCheckbox("Start when I sign in to Windows", "Job Hunt starts by itself, in the background", startOn)
			if !canStart {
				start.Hide()
			}
			quit := systray.AddMenuItem("Stop Job Hunt", "Stops searching until you start it again")
			go func() {
				for {
					select {
					case <-ctx.Done():
						systray.Quit()
						return
					case <-open.ClickedCh:
						showWindow("")
					case <-search.ClickedCh:
						e.Resume("")
						e.StartSearch("full")
						deskNotify("Job Hunt is searching", "New roles that fit will show up on Today.", url+"#/today")
					case <-inbox.ClickedCh:
						if !e.MailSet().On {
							deskNotify("Your inbox isn't connected", "Connect it under You, Connections, and replies are noticed as they arrive.", url+"#/you/connections")
						} else {
							e.Go("mail", "Checking your inbox", func(ctx context.Context) error { return e.CheckMail(ctx) })
							deskNotify("Checking your inbox", "Anything new from an employer shows up under Replies.", url+"#/replies")
						}
					case <-start.ClickedCh:
						on, _ := startsWithWindows()
						if setStartsWithWindows(!on) == nil {
							if on {
								start.Uncheck()
							} else {
								start.Check()
							}
						}
					case <-update.ClickedCh:
						go func() {
							if err := e.CheckUpdate(ctx); err != nil {
								deskNotify("Job Hunt couldn't look for updates", "It tries again by itself.", url+"#/you/app")
							} else if u := e.NewerVersion(); u == nil {
								deskNotify("Job Hunt is up to date", "You are on the newest version.", url+"#/you/app")
							} else if e.InstallUpdate() == nil {
								if e.UpdateWaiting() != "" {
									deskNotify("Job Hunt "+u.Version+" is ready", "It installs as soon as the search in hand has finished.", url+"#/you/app")
								} else {
									deskNotify("Installing Job Hunt "+u.Version, "It comes back by itself in about a minute.", url+"#/you/app")
								}
							}
						}()
					case <-quit.ClickedCh:
						stop()
					}
				}
			}()
		}, func() {})
	}()
}

const toastScript = `$ErrorActionPreference='Stop'
$k='HKCU:\Software\Classes\AppUserModelId\JobHunt3'
if(-not(Test-Path $k)){New-Item -Path $k -Force|Out-Null}
Set-ItemProperty -Path $k -Name DisplayName -Value 'Job Hunt'
if($env:JH_ICON){Set-ItemProperty -Path $k -Name IconUri -Value $env:JH_ICON}
$e=[System.Security.SecurityElement]
$x='<toast activationType="protocol" launch="'+$e::Escape($env:JH_LINK)+'"><visual><binding template="ToastGeneric"><text>'+$e::Escape($env:JH_TITLE)+'</text><text>'+$e::Escape($env:JH_TEXT)+'</text></binding></visual></toast>'
[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null
[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]|Out-Null
$d=New-Object Windows.Data.Xml.Dom.XmlDocument
$d.LoadXml($x)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('JobHunt3').Show((New-Object Windows.UI.Notifications.ToastNotification $d))`

// deskNotify shows a Windows notification; a click opens link. The words go
// to PowerShell through the environment, never through the command line.
func deskNotify(title, text, link string) error {
	if !strings.HasPrefix(link, "http://127.0.0.1:") {
		link = ""
	}
	link = appLink(link)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", toastScript)
	icon := ""
	if me, err := os.Executable(); err == nil {
		icon = me
	}
	cmd.Env = append(os.Environ(), "JH_TITLE="+clip(title, 120), "JH_TEXT="+clip(text, 300), "JH_LINK="+link, "JH_ICON="+icon)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.CombinedOutput()
	if err != nil {
		return errors.New("Windows wouldn't show the notification: " + clip(strings.TrimSpace(string(out)), 300))
	}
	return nil
}

func clip(s string, n int) string {
	s = strings.Join(strings.Fields(strings.ReplaceAll(s, "\x00", "")), " ")
	if r := []rune(s); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}
