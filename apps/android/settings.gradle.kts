pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "commish"

include(":app", ":api", ":design", ":core", ":feature:boxscore", ":feature:leaguehome", ":feature:matchup", ":feature:board", ":feature:shell", ":feature:start", ":feature:waivers", ":feature:trades", ":feature:player", ":feature:rankings", ":feature:record", ":feature:account", ":feature:reference", ":feature:companion", ":feature:mock", ":storeshots", ":storeshots-png")
