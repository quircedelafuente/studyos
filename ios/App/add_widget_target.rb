#!/usr/bin/env ruby
# add_widget_target.rb
# Añade automáticamente el target StudyWidget (Widget Extension con Live Activity)
# al proyecto Xcode de Capacitor.
#
# Uso:  ruby add_widget_target.rb

require 'xcodeproj'
require 'fileutils'

PROJECT_PATH = File.expand_path('../App.xcodeproj', __FILE__)
WIDGET_SOURCES_DIR = File.expand_path('../StudyWidget', __FILE__)  # ios/App/StudyWidget
APP_SOURCES_DIR    = File.expand_path('../App', __FILE__)          # ios/App/App

BUNDLE_ID_APP    = 'com.agustmun.iestudio'
BUNDLE_ID_WIDGET = 'com.agustmun.iestudio.StudyWidget'
TEAM_ID          = 'QCQL2JX4UQ'
WIDGET_NAME      = 'StudyWidget'
MIN_IOS_WIDGET   = '16.2'
MIN_IOS_APP      = '15.0'   # mantener el que ya tiene Podfile

proj = Xcodeproj::Project.open(PROJECT_PATH)
app_target = proj.targets.find { |t| t.name == 'App' }
raise 'No se encontró el target App' unless app_target

# ── ¿Ya existe el target? ──────────────────────────────────────────────────
if proj.targets.find { |t| t.name == WIDGET_NAME }
  puts "✅  El target '#{WIDGET_NAME}' ya existe. Nada que hacer."
  exit 0
end

puts "➕  Creando target '#{WIDGET_NAME}'…"

# ── 1. Crear el target de extensión ───────────────────────────────────────
widget_target = proj.new_target(
  'com.apple.product-type.app-extension',
  WIDGET_NAME,
  :ios,
  MIN_IOS_WIDGET
)

# ── 2. Build settings ─────────────────────────────────────────────────────
%w[Debug Release].each do |config|
  s = widget_target.build_configuration_list[config].build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER']     = BUNDLE_ID_WIDGET
  s['INFOPLIST_FILE']                = "#{WIDGET_NAME}/Info.plist"
  s['SWIFT_VERSION']                 = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET']    = MIN_IOS_WIDGET
  s['TARGETED_DEVICE_FAMILY']        = '1'
  s['SKIP_INSTALL']                  = 'YES'
  s['CODE_SIGN_STYLE']               = 'Automatic'
  s['DEVELOPMENT_TEAM']              = TEAM_ID
  s['LD_RUNPATH_SEARCH_PATHS']       = '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
  s['ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES'] = 'NO'
end

# Actualizar deployment target del target App (Podfile ya está en 15.0)
%w[Debug Release].each do |config|
  s = app_target.build_configuration_list[config].build_settings
  s['IPHONEOS_DEPLOYMENT_TARGET'] = MIN_IOS_APP
end

# ── 3. Grupo de ficheros en Xcode ──────────────────────────────────────────
widget_group = proj.main_group.find_subpath(WIDGET_NAME) ||
               proj.main_group.new_group(WIDGET_NAME, WIDGET_NAME)

# ── 4. Añadir ficheros Swift ───────────────────────────────────────────────
# StudySessionAttributes.swift → App + StudyWidget
# StudyWidgetLiveActivity.swift → sólo StudyWidget
# StudyWidgetBundle.swift → sólo StudyWidget
files = {
  'StudySessionAttributes.swift'  => [app_target, widget_target],
  'StudyWidgetLiveActivity.swift' => [widget_target],
  'StudyWidgetBundle.swift'       => [widget_target],
}

files.each do |filename, targets|
  src_path = File.join(WIDGET_SOURCES_DIR, filename)
  raise "Falta: #{src_path}" unless File.exist?(src_path)

  file_ref = widget_group.new_reference(filename)
  file_ref.source_tree = '<group>'

  targets.each { |t| t.source_build_phase.add_file_reference(file_ref) }
  puts "   📄  #{filename} → #{targets.map(&:name).join(', ')}"
end

# Info.plist como resource reference (no se compila, es sólo referencia)
info_ref = widget_group.new_reference('Info.plist')
info_ref.source_tree = '<group>'
info_ref.last_known_file_type = 'text.plist.xml'

# ── 5. Frameworks: WidgetKit + ActivityKit ─────────────────────────────────
widget_target.add_system_framework('WidgetKit')
widget_target.add_system_framework('ActivityKit')
puts "   🔗  WidgetKit + ActivityKit añadidos"

# ── 6. Embed la extensión en el target App ────────────────────────────────
# El widget product debe embeberse en la app para que iOS lo despliegue.
embed_phase = app_target.copy_files_build_phases.find do |p|
  p.name == 'Embed Foundation Extensions' || p.dst_subfolder_spec == '13'
end

unless embed_phase
  embed_phase = app_target.new_copy_files_build_phase('Embed Foundation Extensions')
  embed_phase.dst_subfolder_spec = '13'
  embed_phase.dst_path = ''
end

embed_build_file = embed_phase.add_file_reference(widget_target.product_reference)
embed_build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
puts "   📦  Widget embebido en App target"

# ── 7. Guardar ────────────────────────────────────────────────────────────
proj.save
puts ""
puts "✅  Target '#{WIDGET_NAME}' añadido correctamente a #{PROJECT_PATH}"
puts ""
puts "⚠️  PRÓXIMOS PASOS:"
puts "   1. Abre Xcode: open ios/App/App.xcworkspace"
puts "   2. Selecciona target StudyWidget → Signing → Team: QCQL2JX4UQ"
puts "   3. Product → Clean Build Folder (⌘⇧K)"
puts "   4. Run en el dispositivo"
