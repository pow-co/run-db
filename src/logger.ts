
import { DEBUG } from './config'

export interface Logger {
	info?: (a?: any, b?: any) => void
	warn?: (a?: any, b?: any) => void
	error?: (a?: any, b?: any, c?: any) => void
	debug?: (a?: any, b?: any) => void
}


const logger: Logger = {}
logger.info = console.info.bind(console)
logger.warn = console.warn.bind(console)
logger.error = console.error.bind(console)
logger.debug = DEBUG ? console.debug.bind(console) : () => {}

export default logger 
