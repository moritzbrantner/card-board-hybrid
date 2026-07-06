fn main() {
    if let Err(error) = backend::ai_lab::run_from_env() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
