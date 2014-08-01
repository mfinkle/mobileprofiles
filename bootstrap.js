const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "Prompt",
                                  "resource://gre/modules/Prompt.jsm");

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
    if (this.service) {
      return;
    }
    this.service = Cc["@mozilla.org/toolkit/profile-service;1"].getService(Ci.nsIToolkitProfileService);
  },

  // Returns a new array of all nsIToolkitProfile
  get profiles() {
    let profiles = [];
    let profileList = this.service.profiles;
    while (profileList.hasMoreElements()) {
      let profile = profileList.getNext().QueryInterface(Ci.nsIToolkitProfile);
      profiles.push(profile);
    }
    return profiles;
  },

  // Returns the selected nsIToolkitProfile
  get selected() {
    return this.service.selectedProfile;
  },

  // Creates a new profile with the given name. Does not switch to the new
  // profile. Makes sure a copy of this add-on is in the new profile so the user
  // can manage profiles if they switch.
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
      // Might be using the linked file method
      addon = currentDir.clone();
      addon.append("mobileprofiles@starkravingfinkle.org")
    }

    // Copy this add-on into the new profile so users can switch profiles!
    let extensionsDir = profileDir.clone();
    extensionsDir.append("extensions");
    if (!extensionsDir.exists()) {
      extensionsDir.create(Ci.nsIFile.DIRECTORY_TYPE, 0700);
    }
    addon.copyTo(extensionsDir, addon.leafName);

    return profile;
  },

  // Switches to the given profile, if it exists. Forces a restart of the
  // application.
  change: function change(aName) {
    let target = this.service.getProfileByName(aName);
    if (target) {
      // We need to reset some env vars so the restart will use the new profile
      let env = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
      env.set("XRE_PROFILE_PATH", target.rootDir.path);
      env.set("XRE_PROFILE_LOCAL_PATH", target.localDir.path);
      env.set("XRE_PROFILE_NAME", target.name);

      // Make sure the profile.ini is updated and flushed to disk
      this.service.selectedProfile = target;
      this.service.flush();

      // Do the restart
      let appStartup = Cc["@mozilla.org/toolkit/app-startup;1"].getService(Ci.nsIAppStartup);
      appStartup.quit(Ci.nsIAppStartup.eRestart | Ci.nsIAppStartup.eAttemptQuit);
    }
  },

  // Removes a profile with the given name. Does not remove the active profile.
  remove: function remove(aName) {
    // Can't remove the active profile
    if (aName == this.selected.name) {
      return;
    }

    // Find the profile we want to remove
    let target = this.service.getProfileByName(aName);
    if (target) {
      target.remove(true);
      this.service.flush();
    }
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
      callback: function() { self.backup(aWindow); },
      parent: this.menu.root
    });
    this.menu.clean = aWindow.NativeWindow.menu.add({
      name: "Cleanup Files",
      callback: function() { self.cleanupFiles(aWindow); },
      parent: this.menu.root
    });
    LOG("createUI - done")
  },

  _removeMenu: function _removeMenu(aWindow, aID) {
    if (aID) {
      aWindow.NativeWindow.menu.remove(aID);
    }
  },

  removeUI: function removeUI(aWindow) {
    this._removeMenu(aWindow, this.menu.create);
    this._removeMenu(aWindow, this.menu.remove);
    this._removeMenu(aWindow, this.menu.change);
    this._removeMenu(aWindow, this.menu.backup);
    this._removeMenu(aWindow, this.menu.clean);
    this._removeMenu(aWindow, this.menu.root);
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
      if (name != ProfileHelper.selected.name && !name.startsWith("webapp")) {
        labels.push(name);
      }
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
      if (name != ProfileHelper.selected.name && !name.startsWith("webapp")) {
        labels.push(name);
      }
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

  backup: function backup(aWindow) {
    let prompt = new Prompt({
      title: "Select Data for Backup"
    });

    let choices = [
      { label: "Active profile folder" },
      { label: "Complete application folder" }
    ];
    prompt.setSingleChoiceItems(choices);

    prompt.show(function(aResponse) {
      if (aResponse.button == 0) {
        this.backupProfile(aWindow);
      } else {
        this.backupEverything(aWindow);
      }
    }.bind(this));
  },

  backupProfile: function backupProfile(aWindow) {
    showToast(aWindow, "Copying profile (Please wait)");

    // If we previously copied the profile to the sdcard, remove it first.
    let sdcardProfileDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    sdcardProfileDir.initWithPath("/sdcard/mozilla_profile");
  
    if (sdcardProfileDir.exists()) {
      sdcardProfileDir.remove(true);
      LOG("Removed /sdcard/mozilla_profile");
    }
  
    let sdcardDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    sdcardDir.initWithPath("/sdcard");
  
    let profileDir = FileUtils.getDir("ProfD", [], false);
    profileDir.copyTo(sdcardDir, "mozilla_profile");
  
    LOG("Profile copied to /sdcard/mozilla_profile");

    showToast(aWindow, "Profile copied to /sdcard/mozilla_profile");
  },

  backupEverything: function backupEverything(aWindow) {
    showToast(aWindow, "Copying everything (Please wait)");

    // If we previously copied the profile to the sdcard, remove it first.
    let sdcardProfileDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    sdcardProfileDir.initWithPath("/sdcard/mozilla_everything");
  
    if (sdcardProfileDir.exists()) {
      sdcardProfileDir.remove(true);
      LOG("Removed /sdcard/mozilla_everything");
    }
  
    let sdcardDir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    sdcardDir.initWithPath("/sdcard");
  
    let rootDir = FileUtils.getDir("XCurProcD", [], false);
    rootDir.copyTo(sdcardDir, "mozilla_everything");
  
    LOG("Profile copied to /sdcard/mozilla_everything");
    showToast(aWindow, "Profile copied to /sdcard/mozilla_everything");
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

    function cleanupFilesThatMatch(aFolder, aMatch) {
      let enumerator = aFolder.directoryEntries;
      while (enumerator.hasMoreElements()) {
        let file = enumerator.getNext().QueryInterface(Ci.nsIFile);
        if (file.leafName.indexOf(aMatch) != -1) {
          file.remove(true);
        }
      }
    }

    function cleanupFile(aFile) {
      try {
        aFile.remove(true);
      } catch(e) {}
    }

    let prompt = new Prompt({
      title: "Cleanup Files",
      text: "Choose the type of files to cleanup",
      buttons: ["OK", "Cancel"]
    });

    prompt.addCheckbox({ id: "unexpected", label: "Unexpected files", checked: true })
          .addCheckbox({ id: "crashreports", label: "Old crash reports", checked: true })
          .addCheckbox({ id: "webapps", label: "Old webapp installations", checked: false });

    prompt.show(function(aResponse) {
      if (aResponse.button == 1) {
        return;
      }

      if (aResponse.unexpected == "true") {
        // Root folder whitelist. Any other files will be removed.
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
    
        // Cleans the /root/files folder
        cleanupFilesWithWhitelist(FileUtils.getDir("XCurProcD", ["files"], false), ["mozilla"]);
    
        // Cleans /root/app_tmpdir folder
        cleanupFilesWithWhitelist(FileUtils.getDir("TmpD", [], false), []);

        // Cleans the contents of the old Cache folder in the profile
        cleanupFilesWithWhitelist(FileUtils.getDir("ProfD", ["Cache"], false), []);

        // Removes misc files in the profile
        cleanupFile(FileUtils.getDir("ProfD", ["netpredictions.sqlite"], false));
      }
  
      if (aResponse.crashreports == "true") {
        // Cleans the contents of /root/files/mozilla/Crash Reports folder
        cleanupFilesWithWhitelist(FileUtils.getDir("XCurProcD", ["files", "mozilla", "Crash Reports"], false), []);
      }
  
       if (aResponse.webapps == "true") {
        // Removes /root/files/mozilla/*.webapp# profile folders
        cleanupFilesThatMatch(FileUtils.getDir("XCurProcD", ["files", "mozilla"], false), ".webapp");
      }  
 
      showToast(aWindow, "Unwanted files have been removed");
    });
  }
}

function loadIntoWindow(aWindow) {
  if (!aWindow) {
    return;
  }

  // Setup the UI when we get a window
  NativeUI.createUI(aWindow);
}

function unloadFromWindow(aWindow) {
  if (!aWindow) {
    return;
  }

  // Register to remove the UI on shutdown
  NativeUI.removeUI(aWindow);
}

/**
 * bootstrap.js API
 */

var WindowWatcher = {
  start: function() {
    // Load into any existing windows
    let windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      let window = windows.getNext();
      if (window.document.readyState == "complete") {
        loadIntoWindow(window);
      } else {
        this.waitForLoad(window);
      }
    }
  
    // Load into any new windows
    Services.ww.registerNotification(this);
  },

  stop: function() {
    // Stop listening for new windows
    Services.ww.unregisterNotification(this);
  
    // Unload from any existing windows
    let windows = Services.wm.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
      let window = windows.getNext();
      unloadFromWindow(window);
    }
  },

  waitForLoad: function(aWindow) {
    aWindow.addEventListener("load", function onLoad() {
      aWindow.removeEventListener("load", onLoad, false);
      let { documentElement } = aWindow.document;
      if (documentElement.getAttribute("windowtype") == "navigator:browser") {
        loadIntoWindow(aWindow);
      }
    }, false);
  },

  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "domwindowopened") {
      this.waitForLoad(aSubject);
    }
  }
};

function startup(aData, aReason) {
  WindowWatcher.start();
}

function shutdown(aData, aReason) {
  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (aReason == APP_SHUTDOWN) {
    return;
  }

  WindowWatcher.stop();
}

function install(aData, aReason) {
}

function uninstall(aData, aReason) {
}
