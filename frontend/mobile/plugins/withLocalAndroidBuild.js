// Makes `gradlew assembleRelease` work on a Windows laptop. Re-applied on every `expo prebuild`
// (android/ is generated, so editing it by hand would be lost). Skipped on EAS.
//
// 1. Long paths. The CMake that ships with the Android SDK (3.22) names each object file after the
//    full path of its source, e.g. CMakeFiles/reanimated.dir/E_/Learning/.../node_modules/...
//    Expo lets those paths grow to 1024 characters, but the ninja bundled with that CMake can't
//    touch files past Windows' 260-character limit ("ninja: error: mkdir/Stat ... longer than 260").
//    expo.android.cmakeObjectPathMax makes CMake shorten longer object paths: it swaps the folders
//    for a 32-character hash but keeps the file name. 256 leaves room for the ".d" file ninja reads
//    next to each object (256 + 2 < 260).
//    The app module builds the autolinked codegen (gesture-handler, screens, svg, ...) inside
//    android/app/.cxx/RelWithDebInfo/<hash>/arm64-v8a/<lib>_autolinked_build/, so deep that the
//    longest shortened path was still 257. Its CMake build folder moves to android/.cxx, which
//    brings that down to 253.
//
// 2. Memory. By default every native module compiles C++ on every CPU thread at once, next to the
//    Gradle and Kotlin daemons and Metro, which ran a 16 GB machine out of memory. The ninja job
//    pool caps compilers per module, and the Gradle settings cap how many modules build at once.
//
// 3. One CPU architecture (arm64-v8a, every recent Android phone) instead of four, so the build is
//    about four times lighter.
const { withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins')

const BEGIN = '// droin: local Windows build settings'
const END = '// droin: end'

const CMAKE_ARGS = ['-DCMAKE_JOB_POOLS=droin=2', '-DCMAKE_JOB_POOL_COMPILE=droin', '-DCMAKE_JOB_POOL_LINK=droin']

const BLOCK = `${BEGIN}
subprojects { p ->
  def localBuildArgs = {
    p.android.defaultConfig.externalNativeBuild.cmake.arguments(${CMAKE_ARGS.map((a) => `"${a}"`).join(', ')})
  }
  p.plugins.withId("com.android.library") { localBuildArgs() }
  p.plugins.withId("com.android.application") {
    localBuildArgs()
    p.android.externalNativeBuild.cmake.buildStagingDirectory = new File(p.rootDir, ".cxx")
  }
}
${END}`

const GRADLE_PROPERTIES = {
  'expo.android.cmakeObjectPathMax': '256',
  'org.gradle.jvmargs': '-Xmx3072m -XX:MaxMetaspaceSize=768m',
  'org.gradle.workers.max': '3',
  'kotlin.daemon.jvmargs': '-Xmx1536m',
  reactNativeArchitectures: 'arm64-v8a',
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const EXISTING_BLOCK = new RegExp(`\\n*${escape(BEGIN)}[\\s\\S]*?(${escape(END)}|$)`)

const withBuildGradle = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withLocalAndroidBuild: expected android/build.gradle to be Groovy')
    }
    const base = cfg.modResults.contents.replace(EXISTING_BLOCK, '').trimEnd()
    cfg.modResults.contents = `${base}\n\n${BLOCK}\n`
    return cfg
  })

const withBuildProperties = (config) =>
  withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(GRADLE_PROPERTIES)) {
      const existing = cfg.modResults.find((item) => item.type === 'property' && item.key === key)
      if (existing) existing.value = value
      else cfg.modResults.push({ type: 'property', key, value })
    }
    return cfg
  })

module.exports = function withLocalAndroidBuild(config) {
  if (process.env.EAS_BUILD) return config
  return withBuildProperties(withBuildGradle(config))
}
