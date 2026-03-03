(function () {
  const sentinel = document.querySelector(".sticky-header__threshold");
  const hasHeaderStickyClass = document.querySelector(
    "#header.wt-header--sticky",
  );
  if (hasHeaderStickyClass) document.body.classList.add("page-header-sticky");
  const header = document.querySelector(".page-header-sticky .page-header");
  const enabledClass = "sticky-enabled";
  const showClass = "sticky-show";
  const desktopMenuTrigger = document.querySelector(
    ".wt-header__sticky-menu-trigger",
  );
  const desktopMenuTriggerActiveCalss =
    "wt-header__sticky-menu-trigger--active";
  const desktopMenuBar = document.querySelector(".wt-drawer--nav");
  const desktopMenuBarShowClass = "wt-drawer--nav-show";
  const desktopHeaderWithMenuBarClass = "page-header--sticky-show-menubar-lg";

  let prevScrollpos = window.pageYOffset;

  const isDesktop = window.matchMedia("(min-width: 1200px)").matches;
  const isMenuBarOpen = () =>
    header.classList.contains(desktopHeaderWithMenuBarClass);
  const isHeaderWithDesktopNav =
    !document.body.classList.contains("mobile-nav");
  const allLLevelsLinks = desktopMenuBar.querySelectorAll("a[data-menu-level]");
  const onlyLevel1Links = desktopMenuBar.querySelectorAll(
    "a[data-menu-level='1']",
  );

  const stickyHeader = {
    show: () => {
      header.classList.add(showClass);

      stickyHeader.visible = true;
      stickyHeader.handleBehavior();
    },
    hide: () => {
      header.classList.remove(showClass);

      stickyHeader.visible = false;
      stickyHeader.handleBehavior();
    },
    enable: () => {
      header.classList.add(enabledClass);

      stickyHeader.enabled = true;
      stickyHeader.handleBehavior();
    },
    disable: () => {
      header.classList.remove(enabledClass, showClass);

      stickyHeader.enabled = false;
      stickyHeader.handleBehavior();
    },
    enabled: false,
    visible: true,
    handleBehavior: () => {
      if (isHeaderWithDesktopNav && isDesktop) {
        stickyHeader.log();
        if (!isMenuBarOpen() && stickyHeader.enabled) {
          setTabindex(allLLevelsLinks, "-1");
        }
        if (isMenuBarOpen() && stickyHeader.enabled) {
          setTabindex(allLLevelsLinks, "0");
        }
        if (!stickyHeader.enabled) {
          setTabindex(onlyLevel1Links, "0");
          if (desktopMenuTrigger) setTabindex([desktopMenuTrigger], "-1");
        } else {
          if (desktopMenuTrigger) setTabindex([desktopMenuTrigger], "0");
        }
      }
    },
    log: () => {},
  };

  window.onscroll = function () {
    const currentScrollPos = window.pageYOffset;
    if (prevScrollpos > currentScrollPos) {
      // header.classList.add(showClass);
      stickyHeader.show();
    } else {
      // header.classList.remove(showClass);
      stickyHeader.hide();
    }
    prevScrollpos = currentScrollPos;
  };

  desktopMenuTrigger?.addEventListener("click", (e) => {
    e.preventDefault();
    desktopMenuBar.classList.toggle(desktopMenuBarShowClass);
    desktopMenuTrigger.classList.toggle(desktopMenuTriggerActiveCalss);
    header.classList.toggle(desktopHeaderWithMenuBarClass);
    stickyHeader.handleBehavior();
  });

  const handleStickySentinel = (entries) => {
    entries.forEach(({ isIntersecting }) => {
      if (isIntersecting) {
        stickyHeader.disable();
      } else {
        stickyHeader.enable();
      }
    });
  };

  const watchStickyHeaderSentinel = new IntersectionObserver(
    handleStickySentinel,
  );

  watchStickyHeaderSentinel.observe(sentinel);
})();
