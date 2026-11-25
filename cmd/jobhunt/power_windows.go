package main

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"jobhunt/internal/api"
	"jobhunt/internal/engine"
	"jobhunt/internal/trace"
)

// Staying awake while Job Hunt works, waking the computer for a search, and
// noticing when Windows slept anyway.

var (
	kernel32             = windows.NewLazySystemDLL("kernel32.dll")
	pSetExecState        = kernel32.NewProc("SetThreadExecutionState")
	pPowerCreateRequest  = kernel32.NewProc("PowerCreateRequest")
	pPowerSetRequest     = kernel32.NewProc("PowerSetRequest")
	pPowerClearRequest   = kernel32.NewProc("PowerClearRequest")
	pCreateWaitableTimer = kernel32.NewProc("CreateWaitableTimerW")
	pSetWaitableTimer    = kernel32.NewProc("SetWaitableTimer")
	pCancelWaitableTimer = kernel32.NewProc("CancelWaitableTimer")
	powrprof             = windows.NewLazySystemDLL("powrprof.dll")
	pCallNtPowerInfo     = powrprof.NewProc("CallNtPowerInformation")
)

// reasonContext is Windows' REASON_CONTEXT with a plain reason string.
type reasonContext struct {
	Version uint32
	Flags   uint32
	Reason  *uint16
	_       [2]uintptr // the rest of the union
}

const (
	powerRequestSystemRequired    = 1
	powerRequestExecutionRequired = 3 // Windows 8 and later: keeps working in Modern Standby
	esContinuous, esSystem        = 0x80000000, 0x00000001
	every                         = 15 * time.Second
)

// powerRequest makes the request Windows shows under "powercfg /requests".
func powerRequest() uintptr {
	if pPowerCreateRequest.Find() != nil {
		return 0
	}
	why, _ := windows.UTF16PtrFromString("Job Hunt is searching for jobs and writing your documents")
	rc := reasonContext{Version: 0, Flags: 1, Reason: why}
	h, _, _ := pPowerCreateRequest.Call(uintptr(unsafe.Pointer(&rc)))
	if h == 0 || h == ^uintptr(0) {
		return 0
	}
	return h
}

func setAwake(req uintptr, on bool) {
	if on {
		pSetExecState.Call(esContinuous | esSystem)
		if req != 0 {
			pPowerSetRequest.Call(req, powerRequestSystemRequired)
			pPowerSetRequest.Call(req, powerRequestExecutionRequired)
		}
		return
	}
	pSetExecState.Call(esContinuous)
	if req != 0 {
		pPowerClearRequest.Call(req, powerRequestSystemRequired)
		pPowerClearRequest.Call(req, powerRequestExecutionRequired)
	}
}

// keepAwake stops Windows from sleeping while Job Hunt works (the screen may
// still turn off), wakes the computer for the next full search when the
// person asked for that, and tells them when Windows slept during work. It
// ends, and lets the computer sleep again, with ctx.
func keepAwake(ctx context.Context, e *engine.Engine) {
	go func() {
		runtime.LockOSThread()
		req := powerRequest()
		timer, _, _ := pCreateWaitableTimer.Call(0, 1, 0)
		on := false
		var wakeAt, holdUntil time.Time
		var toldAt time.Time
		last := time.Now()
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			now := time.Now()
			if d := sleptFor(last, now, every); d > 0 && on {
				trace.Log("app", "Windows slept for %s while Job Hunt was working", howLong(d))
				if now.Sub(toldAt) > time.Hour {
					toldAt = now
					e.Tell("Windows slept during work", "Job Hunt was working when this computer slept for "+howLong(d)+". Under Settings, Connections, On this computer, set Keep this computer awake to Always, or plug it in.", "#/settings/connections?open=desk")
				}
			}
			last = now
			// Woken for a search: stay up long enough for it to start.
			if !wakeAt.IsZero() && !now.Before(wakeAt) {
				holdUntil, wakeAt = wakeAt.Add(5*time.Minute), time.Time{}
			}
			if w := e.WantsAwake() || now.Before(holdUntil); w != on {
				on = w
				setAwake(req, on)
				trace.Log("app", "keeping the computer awake: %v", on)
			}
			if timer != 0 {
				at, ok := e.NextWake()
				switch {
				case !ok && !wakeAt.IsZero():
					pCancelWaitableTimer.Call(timer)
					wakeAt = time.Time{}
					trace.Log("app", "no longer waking the computer")
				case ok && !at.Equal(wakeAt):
					ft := windows.NsecToFiletime(at.UnixNano())
					due := int64(ft.HighDateTime)<<32 | int64(ft.LowDateTime)
					r, _, err := pSetWaitableTimer.Call(timer, uintptr(unsafe.Pointer(&due)), 0, 0, 0, 1)
					wakeAt = at
					if r == 0 {
						trace.Log("problem", "Windows wouldn't set the wake timer: %v", err)
					} else if errors.Is(err, windows.ERROR_NOT_SUPPORTED) {
						trace.Log("app", "this computer can't be woken by a timer")
					} else {
						trace.Log("app", "waking the computer at %s", at.Format("15:04 Mon"))
					}
				}
			}
			select {
			case <-ctx.Done():
				setAwake(req, false)
				if timer != 0 {
					pCancelWaitableTimer.Call(timer)
					windows.CloseHandle(windows.Handle(timer))
				}
				if req != 0 {
					windows.CloseHandle(windows.Handle(req))
				}
				return
			case <-t.C:
			}
		}
	}()
}

// powercfg runs Windows' power settings tool out of sight.
func powercfg(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powercfg", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

var (
	powerMu   sync.Mutex
	powerSeen api.PowerState
	powerAt   time.Time
)

// powerState reads whether Windows allows wake timers while plugged in, and
// whether this is a Modern Standby computer. Read at most every half minute.
func powerState() api.PowerState {
	powerMu.Lock()
	defer powerMu.Unlock()
	if time.Since(powerAt) < 30*time.Second {
		return powerSeen
	}
	st := api.PowerState{Modern: modernStandby()}
	if out, err := powercfg("/q", "SCHEME_CURRENT", "SUB_SLEEP", "RTCWAKE"); err == nil {
		if ac, _, ok := parseWakeSetting(out); ok {
			st.Known, st.Blocked, st.CanAllow = true, ac != 1, ac != 1
		}
	}
	powerSeen, powerAt = st, time.Now()
	return st
}

// allowWake switches "Allow wake timers" on for when the computer is plugged in.
func allowWake() error {
	if out, err := powercfg("/setacvalueindex", "SCHEME_CURRENT", "SUB_SLEEP", "RTCWAKE", "1"); err != nil {
		trace.Log("problem", "powercfg: %v %s", err, out)
		return errors.New(blockedWake)
	}
	powercfg("/setactive", "SCHEME_CURRENT")
	powerMu.Lock()
	powerAt = time.Time{}
	powerMu.Unlock()
	if st := powerState(); st.Known && st.Blocked {
		return errors.New(blockedWake)
	}
	return nil
}

const blockedWake = "Windows didn't let Job Hunt change it. Open Control Panel, Power Options, Change plan settings, Change advanced power settings, then Sleep, Allow wake timers, and choose Enable"

// modernStandby says whether this computer sleeps in Modern Standby, where
// Windows keeps wake timers for itself.
func modernStandby() bool {
	if pCallNtPowerInfo.Find() != nil {
		return false
	}
	var caps [128]byte // SYSTEM_POWER_CAPABILITIES
	r, _, _ := pCallNtPowerInfo.Call(4, 0, 0, uintptr(unsafe.Pointer(&caps[0])), uintptr(len(caps)))
	return r == 0 && caps[20] != 0 // AoAc
}
