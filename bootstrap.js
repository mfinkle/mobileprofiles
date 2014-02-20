const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");

function LOG(msg) {
  Services.console.logStringMessage("MOBILEPROFILES -- " + msg);
}

function showToast(aWindow, aMsg) {
  aWindow.NativeWindow.toast.show(aMsg, "short");
}

/**
 * Wrapper for working with profiles
 */
var ProfileHelper = {
  service: null,

  init: function init() {
    this.service = Cc["@mozilla.org/toolkit/profile-service;1"].getService(Ci.nsIToolkitProfileService);
  },

  get profiles() {
    let profiles = [];
    let profileList = this.service.profiles;
    while (profileList.hasMoreElements()) {
      let profile = profileList.getNext().QueryInterface(Ci.nsIToolkitProfile);
      profiles.push(profile);
    }
    return profiles;
  },

  get selected() {
    return this.service.selectedProfile;
  },

  create: function create(aName) {
    let profile = this.service.createProfile(null, null, aName);
    let profileDir = profile.rootDir.clone();
    this.service.flush();

    // Find this add-on in the current profile
    currentDir = this.selected.rootDir.clone();
    currentDir.append("extensions");
    let addon = currentDir.clone();
    addon.append("mobileprofiles@starkravingfinkle.org.xpi");
    if (!addon.exists()) {
      // might be using the linked file method
      addon = currentDir.clone();
      addon.append("mobileprofiles@starkravingfinkle.org")
    }

    // Copy this add-on into the new profile so users can switch profiles!
    let extensionsDir = profileDir.clone();
    extensionsDir.append("extensions");
    if (!extensionsDir.exists())
      extensionsDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0700);
    addon.copyTo(extensionsDir, addon.leafName);

    return profile;
  },

  change: function change(aName) {
    let target = this.service.getProfileByName(aName);
    if (target) {
      // We need to reset some env vars so the restart will use the new profile
      let env = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
      env.set("XRE_PROFILE_PATH", target.rootDir.path);
      env.set("XRE_PROFILE_LOCAL_PATH", target.localDir.path);
      env.set("XRE_PROFILE_NAME", target.name);

      this.service.selectedProfile = target;
      this.service.flush();

      let appStartup = Cc["@mozilla.org/toolkit/app-startup;1"].getService(Ci.nsIAppStartup);
      appStartup.quit(Ci.nsIAppStartup.eRestart | Ci.nsIAppStartup.eAttemptQuit);
    }
  },

  remove: function remove(aName) {
    // Can't remove the active profile
    if (aName == this.selected.name)
      return;

    // Find the profile we want to remove
    let target = this.service.getProfileByName(aName);
    if (target) {
      target.remove(true);
      this.service.flush();
    }
  },

  backup: function backup() {
    // If we previously copied the profile to the sdcard, remove it first.
    let sdcardProfileDir = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsILocalFile);
    sdcardProfileDir.initWithPath("/sdcard/mozilla_profile");
  
    if (sdcardProfileDir.exists()) {
      sdcardProfileDir.remove(true);
      LOG("Removed /sdcard/mozilla_profile");
    }
  
    let sdcardDir = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsILocalFile);
    sdcardDir.initWithPath("/sdcard");
  
    let profileDir = FileUtils.getDir("ProfD", [], false);
    profileDir.copyTo(sdcardDir, "mozilla_profile");
  
    LOG("Profile copied to /sdcard/mozilla_profile");
  }
};


var NativeUI = {
  menu: {
    root: null,
    create: null,
    remove: null,
    change: null,
    backup: null,
    clean: null
  },

  createUI: function createUI(aWindow) {
    ProfileHelper.init();

    let self = this;
    this.menu.root = aWindow.NativeWindow.menu.add({
      name: "Profiles",
      parent: aWindow.NativeWindow.menu.toolsMenuID
    });
    this.menu.create = aWindow.NativeWindow.menu.add({
      name: "Create",
      callback: function() { self.createProfile(aWindow); },
      parent: this.menu.root
    });
    this.menu.remove = aWindow.NativeWindow.menu.add({
      name: "Delete",
      callback: function() { self.removeProfile(aWindow); },
      parent: this.menu.root
    });
    this.menu.change = aWindow.NativeWindow.menu.add({
      name: "Switch",
      callback: function() { self.changeProfile(aWindow); },
      parent: this.menu.root
    });
    this.menu.backup = aWindow.NativeWindow.menu.add({
      name: "Backup",
      callback: function() { self.backupProfile(aWindow); },
      parent: this.menu.root
    });
    this.menu.clean = aWindow.NativeWindow.menu.add({
      name: "Cleanup Files",
      callback: function() { self.cleanupFiles(aWindow); },
      parent: this.menu.root
    });
  },

  removeUI: function removeUI(aWindow) {
    aWindow.NativeWindow.menu.remove(this.menu.create);
    aWindow.NativeWindow.menu.remove(this.menu.remove);
    aWindow.NativeWindow.menu.remove(this.menu.change);
    aWindow.NativeWindow.menu.remove(this.menu.backup);
    aWindow.NativeWindow.menu.remove(this.menu.clean);
    aWindow.NativeWindow.menu.remove(this.menu.root);
  },

  createProfile: function createProfile(aWindow) {
    let result = { value: "" };
    let dummy = { value: 0 };
    let retval = Services.prompt.prompt(aWindow, "Create a Profile", "Name", result, null, dummy);
    if (retval && result.value) {
      let newProfile = ProfileHelper.create(result.value);
      showToast(aWindow, "New profile has been created");
    }
  },

  removeProfile: function removeProfile(aWindow) {
    let profiles = ProfileHelper.profiles;
    let labels = [];
    let found = false;
  
    for (let i = 0; i < profiles.length; i++) {
      let name = profiles[i].name;
      // Skip the active profile and any webapp profiles
      if (name != ProfileHelper.selected.name && !name.startsWith("webapp"))
        labels.push(name);
    }
    if (labels.length > 0) {
      let res = { value: null };
      if (Services.prompt.select(aWindow, "Delete a Profile", "Select", labels.length, labels, res)) {
        LOG("remove: " + res.value)
        showToast(aWindow, "Deleting profile (Please wait)");
        ProfileHelper.remove(labels[res.value]);
        showToast(aWindow, "Profile has been deleted");
      }
    }
  },

  changeProfile: function changeProfile(aWindow) {
    let profiles = ProfileHelper.profiles;
    let labels = [];
    let found = false;
  
    for (let i = 0; i < profiles.length; i++) {
      let name = profiles[i].name;
      // Skip the active profile and any webapp profiles
      if (name != ProfileHelper.selected.name && !name.startsWith("webapp"))
        labels.push(name);
    }
    if (labels.length > 0) {
      let res = { value: null };
      if (Services.prompt.select(aWindow, "Profiles", "Select", labels.length, labels, res)) {
        LOG("changeto: " + res.value)
        showToast(aWindow, "Restarting to change profiles (Please wait)");
        ProfileHelper.change(labels[res.value]);
      }
    }
  },

  backupProfile: function backupProfile(aWindow) {
    showToast(aWindow, "Copying profile (Please wait)");
    ProfileHelper.backup();
    showToast(aWindow, "Profile copied to /sdcard/mozilla_profile");
  },

  cleanupFiles: function cleanupFiles(aWindow) {
    function cleanupFilesWithWhitelist(aFolder, aWhitelist) {
      let enumerator = aFolder.directoryEntries;
      while (enumerator.hasMoreElements()) {
        let file = enumerator.getNext().QueryInterface(Ci.nsIFile);
        if (aWhitelist.indexOf(file.leafName) == -1) {
          file.remove(true);
        }
      }
    }

    // Root folder
    let rootWhitelist = [
      "app_plugins",
      "app_plugins_private",
      "app_tmpdir",
      "cache",
      "files",
      "lib",
      "shared_prefs",
      "distribution",
    ];
    cleanupFilesWithWhitelist(FileUtils.getDir("XCurProcD", [], false), rootWhitelist);

    // /root/files folder
    cleanupFilesWithWhitelist(FileUtils.getDir("XCurProcD", ["files"], false), ["mozilla", "history.xml"]);

    // /root/app_tmpdir folder
    cleanupFilesWithWhitelist(FileUtils.getDir("TmpD", [], false), []);

    showToast(aWindow, "Unwanted files have been removed");
  }
}

/**
 * Load our UI into a given window
 */
function loadIntoWindow(window) {
  if (!window)
    return;

  NativeUI.createUI(window);
}

/**
 * Remove our UI into a given window
 */
function unloadFromWindow(window) {
  if (!window)
    return;

  NativeUI.removeUI(window);
}


/**
 * bootstrap.js API
 */

function startup(aData, aReason) {
  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

  // Load into any existing windows
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    loadIntoWindow(domWindow);
  }

  // Load into any new windows
  wm.addListener({
    onOpenWindow: function(aWindow) {
      // Wait for the window to finish loading
      let domWindow = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
      domWindow.addEventListener("load", function() {
        domWindow.removeEventListener("load", arguments.callee, false);
        loadIntoWindow(domWindow);
      }, false);
    },

    onCloseWindow: function(aWindow) {
    },

    onWindowTitleChange: function(aWindow, aTitle) {
    }
  });
}

function shutdown(aData, aReason) {
  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (aReason == APP_SHUTDOWN)
    return;

  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

  // Unload from any existing windows
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    unloadFromWindow(domWindow);
  }
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
}
