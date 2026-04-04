#!/usr/bin/env ruby
# setup_screen_time.rb
# Añade ScreenTimePlugin.swift al target App de Xcode,
# enlaza FamilyControls + ManagedSettings, y configura el entitlements.
#
# Uso:  cd ios/App && ruby setup_screen_time.rb

require 'xcodeproj'

PROJECT_PATH   = File.expand_path('../App.xcodeproj', __FILE__)
APP_DIR        = File.expand_path('../App', __FILE__)
SWIFT_FILENAME = 'ScreenTimePlugin.swift'
ENTITLEMENTS   = 'App/App.entitlements'
TEAM_ID        = 'QCQL2JX4UQ'

proj       = Xcodeproj::Project.open(PROJECT_PATH)
app_target = proj.targets.find { |t| t.name == 'App' }
raise 'Target App no encontrado' unless app_target

# ── 1. Añadir ScreenTimePlugin.swift al grupo App ─────────────────────────
app_group = proj.main_group.find_subpath('App') ||
            proj.main_group.new_group('App', 'App')

already_ref = app_group.files.find { |f| f.path == SWIFT_FILENAME }

if already_ref
  puts "ℹ️   #{SWIFT_FILENAME} ya estaba en el grupo — verificando build phase…"
  file_ref = already_ref
else
  file_ref = app_group.new_reference(SWIFT_FILENAME)
  file_ref.source_tree = '<group>'
  puts "📄  #{SWIFT_FILENAME} añadido al grupo App"
end

# Añadir a Sources si no está
sources_phase = app_target.source_build_phase
unless sources_phase.files_references.include?(file_ref)
  sources_phase.add_file_reference(file_ref)
  puts "🔧  #{SWIFT_FILENAME} añadido a Sources de App"
else
  puts "ℹ️   #{SWIFT_FILENAME} ya estaba en Sources"
end

# ── 2. Enlazar FamilyControls + ManagedSettings ───────────────────────────
%w[FamilyControls ManagedSettings].each do |fw|
  link_phase = app_target.frameworks_build_phase
  already = link_phase.files.any? { |f| f.display_name == "#{fw}.framework" }
  if already
    puts "ℹ️   #{fw}.framework ya enlazado"
  else
    app_target.add_system_framework(fw)
    puts "🔗  #{fw}.framework enlazado"
  end
end

# ── 3. Configurar entitlements + signing en build settings ────────────────
%w[Debug Release].each do |config|
  settings = app_target.build_configuration_list[config].build_settings
  current = settings['CODE_SIGN_ENTITLEMENTS']
  if current && !current.empty?
    puts "ℹ️   CODE_SIGN_ENTITLEMENTS ya configurado (#{current}) en #{config}"
  else
    settings['CODE_SIGN_ENTITLEMENTS'] = ENTITLEMENTS
    puts "🔐  CODE_SIGN_ENTITLEMENTS = #{ENTITLEMENTS} (#{config})"
  end
  settings['CODE_SIGN_STYLE']   = 'Automatic'
  settings['DEVELOPMENT_TEAM']  = TEAM_ID
end

# ── 4. Guardar ────────────────────────────────────────────────────────────
proj.save
puts ''
puts '✅  Configuración Screen Time completada en App.xcodeproj'
puts ''
puts '⚠️  PRÓXIMOS PASOS:'
puts '   1. Abre (o reabre) ios/App/App.xcworkspace en Xcode'
puts '   2. Product → Clean Build Folder (⌘⇧K)'
puts '   3. Ejecuta en el dispositivo'
