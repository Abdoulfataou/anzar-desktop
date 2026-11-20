//! Windows : chaque commande de l'agent tourne dans un « job object ».
//!
//! - Arrêter la commande arrête toute son arborescence (npm → node → …), pas seulement le
//!   premier processus ; à la fermeture d'ANZAR, le système tue tout ce qui reste.
//! - Le presse-papiers (lecture et écriture), l'arrêt de la session et les réglages
//!   système et d'affichage sont inaccessibles aux processus du job.
//!
//! Ce n'est pas encore une isolation des fichiers (jeton restreint / AppContainer) :
//! voir docs/desktop/SECURITY.md.

#![cfg(windows)]

use std::os::windows::io::AsRawHandle;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicUIRestrictions,
    JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
    JOBOBJECT_BASIC_UI_RESTRICTIONS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS,
    JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
    JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
};

pub struct Job(HANDLE);

// Le handle n'est utilisé que par TerminateJobObject / CloseHandle, appelables depuis n'importe quel thread.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    /// Crée un job restreint et y place le processus. None si le système refuse (le processus
    /// tourne alors sans job, comme avant).
    pub fn assign(child: &std::process::Child) -> Option<Job> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let job = Job(handle);

            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );

            let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
                UIRestrictionsClass: JOB_OBJECT_UILIMIT_READCLIPBOARD
                    | JOB_OBJECT_UILIMIT_WRITECLIPBOARD
                    | JOB_OBJECT_UILIMIT_EXITWINDOWS
                    | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
                    | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS,
            };
            SetInformationJobObject(
                job.0,
                JobObjectBasicUIRestrictions,
                &ui as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
            );

            if AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) == 0 {
                return None; // Drop ferme le handle
            }
            Some(job)
        }
    }

    /// Arrête tous les processus du job (la commande et ce qu'elle a lancé).
    pub fn terminate(&self, code: u32) {
        unsafe {
            TerminateJobObject(self.0, code);
        }
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
